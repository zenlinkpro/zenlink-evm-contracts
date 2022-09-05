// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AdminUpgradeable} from "../libraries/AdminUpgradeable.sol";
import {IFactory} from "../core/interfaces/IFactory.sol";
import {IPair} from "../core/interfaces/IPair.sol";
import {IStableSwap} from "../stableswap/interfaces/IStableSwap.sol";

contract ZenlinkMaker is AdminUpgradeable {
    using SafeERC20 for IERC20;

    IFactory public immutable factory;
    address public immutable vxzlk;
    address private immutable zlk;
    address private immutable wnative;

    uint256 public constant PRECISION = 10**3;
    address public feeDistributor;
    uint256 public fee;

    mapping(address => address) internal _bridges;
    mapping(address => uint8) internal _stableSwapFeeTokenIndex;

    event LogBridgeSet(address indexed token, address indexed bridge);
    event LogStableSwapFeeTokenIndexSet(address indexed pool, uint8 indexed feeTokenIndex);
    event FeeDistributorChanged(address newController);
    event FeeChanged(uint256 newFee);
    event LogConvertPair(
        address indexed sender, 
        address indexed token0, 
        address indexed token1, 
        uint256 amount0, 
        uint256 amount1, 
        uint256 amountZLK
    );
    event LogConvertStableSwap(
        address indexed sender, 
        address indexed pool,
        address indexed token,
        uint256 amount,
        uint256 amountZLK
    );

    error NotEOA(address account);
    error BridgeTokenInvalid(address token);
    error TokenIndexInvalid(uint8 feeTokenIndex);
    error ZeroAddress();
    error FeeExceedsMaximum(uint256 newFee, uint256 max);
    error ArrayMismatch();

    constructor(
        IFactory _factory,
        address _vxzlk,
        address _zlk,
        address _wnative,
        address _feeDistributor
    ) {
        factory = _factory;
        vxzlk = _vxzlk;
        zlk = _zlk;
        wnative = _wnative;
        feeDistributor = _feeDistributor;
        _initializeAdmin(msg.sender);
    }

    modifier onlyEOA() {
        if (msg.sender != tx.origin) revert NotEOA(msg.sender);
        _;
    } 

    function bridgeFor(address token) public view returns (address bridge) {
        bridge = _bridges[token];
        if (bridge == address(0)) {
            bridge = wnative;
        }
    }

    function feeTokenIndexFor(address pool) public view returns (uint8 feeTokenIndex) {
        feeTokenIndex = _stableSwapFeeTokenIndex[pool];
    }

    function setBridge(address token, address bridge) external onlyAdmin {
        if (token == zlk || token == wnative || token == bridge) 
            revert BridgeTokenInvalid(token);

        _bridges[token] = bridge;
        emit LogBridgeSet(token, bridge);
    }

    function setFeeTokenIndex(address pool, uint8 feeTokenIndex) external onlyAdmin {
        if (feeTokenIndex >= IStableSwap(pool).getNumberOfTokens())
            revert TokenIndexInvalid(feeTokenIndex);

        _stableSwapFeeTokenIndex[pool] = feeTokenIndex;
        emit LogStableSwapFeeTokenIndexSet(pool, feeTokenIndex);
    }

    function setFeeDistributor(address _feeDistributor) external onlyAdmin {
        if (_feeDistributor == address(0)) revert ZeroAddress();
        feeDistributor = _feeDistributor;
        emit FeeDistributorChanged(_feeDistributor);
    }

    function setFee(uint256 newFee) external onlyAdmin {
        if (newFee > PRECISION) revert FeeExceedsMaximum(newFee, PRECISION);
        fee = newFee;
        emit FeeChanged(newFee);
    }

    function convertPair(address token0, address token1) external onlyEOA() {
        _convertPair(token0, token1);
    }

    function convertStableSwap(IStableSwap pool) external onlyEOA() {
        _convertStableSwap(pool);
    }

    function convertPairMultiple(
        address[] calldata tokens0, 
        address[] calldata tokens1
    ) external onlyEOA() {
        uint256 len = tokens0.length;
        if (len != tokens1.length) revert ArrayMismatch();
        for (uint256 i = 0; i < len; i++) {
            _convertPair(tokens0[i], tokens1[i]);
        }
    }

    function convertStableSwapMultiple(IStableSwap[] calldata pools) external onlyEOA() {
        for (uint256 i = 0; i < pools.length; i++) {
            _convertStableSwap(pools[i]);
        }
    }

    function _convertPair(address token0, address token1) internal {
        IPair pair = IPair(factory.getPair(token0, token1));
        if (address(pair) == address(0)) revert ZeroAddress();

        uint256 amount = IERC20(address(pair)).balanceOf(address(this));
        IERC20(address(pair)).safeTransfer(address(pair), amount);
        (uint256 amount0, uint256 amount1) = pair.burn(address(this));
        if (token0 != pair.token0()) {
            (amount0, amount1) = (amount1, amount0);
        }
        uint256 amount0Fee = (amount0 * fee) / PRECISION;
        uint256 amount1Fee = (amount1 * fee) / PRECISION;
        if (amount0Fee > 0) {
            IERC20(token0).safeTransfer(feeDistributor, amount0Fee);
        }
        if (amount1Fee > 0) {
            IERC20(token1).safeTransfer(feeDistributor, amount1Fee);
        }
        emit LogConvertPair(
            msg.sender, 
            token0, 
            token1, 
            amount0 - amount0Fee, 
            amount1 - amount1Fee, 
            _convertStep(token0, token1, amount0 - amount0Fee, amount1 - amount1Fee)
        );
    }

    function _convertStableSwap(IStableSwap pool) internal {
        pool.withdrawAdminFee();
        IERC20[] memory tokens = pool.getTokens();
        uint8 feeTokenIndex = _stableSwapFeeTokenIndex[address(pool)];
        IERC20 feeToken = pool.getToken(feeTokenIndex);

        for (uint8 i = 0; i < tokens.length; i++) {
            if (i == feeTokenIndex) continue;

            uint256 balance = tokens[i].balanceOf(address(this));
            tokens[i].safeIncreaseAllowance(address(pool), balance);
            pool.swap(i, feeTokenIndex, balance, 0, block.timestamp);
        }

        uint256 amount = feeToken.balanceOf(address(this));
        uint256 feeAmount = (amount * fee) / PRECISION;
        if (feeAmount > 0) {
            feeToken.safeTransfer(feeDistributor, feeAmount);
        }

        emit LogConvertStableSwap(
            msg.sender,
            address(pool),
            address(feeToken),
            amount - feeAmount,
            _convertStep(address(feeToken), address(feeToken), amount - feeAmount, 0)
        );
    }

    function _convertStep(
        address token0,
        address token1,
        uint256 amount0,
        uint256 amount1
    ) internal returns(uint256 zlkOut) {
        if (token0 == token1) {
            uint256 amount = amount0 + amount1;
            
            if (token0 == zlk) {
                IERC20(zlk).safeTransfer(vxzlk, amount);
                zlkOut = amount;
            } else if (token0 == wnative) {
                zlkOut = _toZLK(wnative, amount);
            } else {
                address bridge = bridgeFor(token0);
                amount = _swap(token0, bridge, amount, address(this));
                zlkOut = _convertStep(bridge, bridge, amount, 0);
            }
        } else if (token0 == zlk) {
            IERC20(zlk).safeTransfer(vxzlk, amount0);
            zlkOut = _toZLK(token1, amount1) + amount0;
        } else if (token1 == zlk) {
            IERC20(zlk).safeTransfer(vxzlk, amount1);
            zlkOut = _toZLK(token0, amount0) + amount1;
        } else if (token0 == wnative) {
            zlkOut = _toZLK(wnative, _swap(token1, wnative, amount1, address(this)) + amount0);
        } else if (token1 == wnative) {
            zlkOut = _toZLK(wnative, _swap(token0, wnative, amount0, address(this)) + amount1);
        } else {
            address bridge0 = bridgeFor(token0);
            address bridge1 = bridgeFor(token1);

            if (bridge0 == token1) {
                zlkOut = _convertStep(
                    bridge0,
                    token1,
                    _swap(token0, bridge0, amount0, address(this)),
                    amount1
                );
            } else if (bridge1 == token0) {
                zlkOut = _convertStep(
                    token0,
                    bridge1,
                    amount0,
                    _swap(token1, bridge1, amount1, address(this))
                );
            } else {
                zlkOut = _convertStep(
                    bridge0,
                    bridge1,
                    _swap(token0, bridge0, amount0, address(this)),
                    _swap(token1, bridge1, amount1, address(this))
                );
            }
        }
    }

    function _swap(
        address fromToken, 
        address toToken, 
        uint256 amountIn, 
        address to
    ) internal returns(uint256 amountOut) {
        IPair pair = IPair(factory.getPair(fromToken, toToken));
        if (address(pair) == address(0)) revert ZeroAddress();

        (uint256 reserve0, uint256 reserve1, ) = pair.getReserves();
        uint256 amountInWithFee = amountIn * 997;

        if (fromToken == pair.token0()) {
            amountOut = (amountInWithFee * reserve1) / (reserve0 * 1000 + amountInWithFee);
            IERC20(fromToken).safeTransfer(address(pair), amountIn);
            pair.swap(0, amountOut, to, new bytes(0));
        } else {
            amountOut = (amountInWithFee * reserve0) / (reserve1 * 1000 + amountInWithFee);
            IERC20(fromToken).safeTransfer(address(pair), amountIn);
            pair.swap(amountOut, 0, to, new bytes(0));
        }
    }

    function _toZLK(address token, uint256 amountIn) internal returns(uint256 amountOut) {
        amountOut = _swap(token, zlk, amountIn, vxzlk);
    }
}
