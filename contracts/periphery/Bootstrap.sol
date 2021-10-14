// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import "../libraries/Math.sol";
import "../libraries/Helper.sol";
import "../libraries/AdminUpgradeable.sol";
import "../core/interfaces/IFactory.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract Bootstrap is ReentrancyGuard, AdminUpgradeable {
    using Math for uint256;

    struct UserInfo {
        uint256 amount0;
        uint256 amount1;
    }

    address public factory;
    address public token0;
    address public token1;

    uint256 public constant MINIMUM_LIQUIDITY = 10**3;
    uint256 public MINUM_AMOUNT0;
    uint256 public MINUM_AMOUNT1;
    uint256 public END_BLOCK;

    uint256 public totalAmount0;
    uint256 public totalAmount1;

    mapping(address => UserInfo) private _userInfos;

    event Provided(address indexed user, uint256 amount0, uint256 amount1);
    event LiquidityClaimed(address indexed to, uint256 amount);
    event Refund(address indexed to, uint256 amount0, uint256 amount1);
    event Withdraw(address indexed token, address indexed to, uint256 amount);
    event MinumAmountUpdated(uint256 amount0, uint256 amount1);
    event EndBlockUpdated(uint256 endBlock);

    constructor(
        address _factory,
        address _tokenA,
        address _tokenB,
        uint256 _minumAmountA,
        uint256 _minumAmountB,
        uint256 _endBlock
    ) {
        require(_endBlock > block.number, 'INVALID_END_BLOCK');
        (address _token0, address _token1) = Helper.sortTokens(_tokenA, _tokenB);
        require(
            IFactory(_factory).getPair(_token0, _token1) == address(0), 
            'PAIR_EXISTS'
        );
        require(
            IFactory(_factory).getBootstrap(_token0, _token1) != address(0), 
            'BOOTSTRAP_NOT_EXISTS'
        );
        factory = _factory;
        token0 = _token0;
        token1 = _token1;
        MINUM_AMOUNT0 = _token0 == _tokenA ? _minumAmountA : _minumAmountB;
        MINUM_AMOUNT1 = _token0 == _tokenA ? _minumAmountB : _minumAmountA;
        END_BLOCK = _endBlock;
        _initializeAdmin(msg.sender);
    }

    modifier whenNotEnded() {
        require(block.number < END_BLOCK, 'BOOTSTRAP_ENDED');
        _;
    }

    modifier whenEndedAndCapped {
        require(
            block.number >= END_BLOCK &&
            totalAmount0 >= MINUM_AMOUNT0 &&
            totalAmount1 >= MINUM_AMOUNT1,
            'NOT_ENDED_AND_CAPPED'
        );
        _;
    }

    modifier whenEndedAndFailed {
        require(
            block.number >= END_BLOCK &&
            (totalAmount0 < MINUM_AMOUNT0 || totalAmount1 < MINUM_AMOUNT1),
            'NOT_ENDED_AND_FAILED'
        );
        _;
    }

    modifier whenLiquidityMinted {
        address pair = Helper.pairFor(factory, token0, token1);
        require(pair != address(0), 'PAIR_NOT_CREATED');
        require(
            IERC20(pair).balanceOf(address(this)) > 0, 
            'LIQUIDITY_NOT_MINTED'
        );
        _;
    }

    function setMinumAmount0(uint256 amount0) 
        external 
        whenNotEnded 
        onlyAdmin 
    {
        MINUM_AMOUNT0 = amount0;
        emit MinumAmountUpdated(amount0, MINUM_AMOUNT1);
    }

    function setMinumAmount1(uint256 amount1) 
        external 
        whenNotEnded 
        onlyAdmin 
    {
        MINUM_AMOUNT1 = amount1;
        emit MinumAmountUpdated(MINUM_AMOUNT0, amount1);
    }

    function setEndBlock(uint256 endBlock) 
        external 
        whenNotEnded 
        onlyAdmin 
    {
        require(endBlock > block.number, 'INVALID_END_BLOCK');
        END_BLOCK = endBlock;
        emit EndBlockUpdated(endBlock);
    }

    function getUserInfo(address user) 
        external 
        view 
        returns (uint256 amount0, uint256 amount1)  
    {
        UserInfo memory userInfo = _userInfos[user];
        amount0 = userInfo.amount0;
        amount1 = userInfo.amount1;
    }
    
    function getTotalLiquidity() 
        public 
        view 
        returns (uint256 totalLiquidity) 
    {
        if (totalAmount0 == 0 || totalAmount1 == 0) return 0;
        totalLiquidity = Math.sqrt(totalAmount0.mul(totalAmount1));
    }

    function getExactLiquidity(address user) 
        public 
        view 
        returns (uint256 exactLiquidity) 
    {
        if (totalAmount0 == 0 || totalAmount1 == 0) return 0;
        UserInfo memory userInfo = _userInfos[user];
        uint256 _amount0 = userInfo.amount0;
        uint256 _amount1 = userInfo.amount1;
        uint256 exactAmount0 = 
            _amount0.mul(totalAmount1).add(_amount1.mul(totalAmount0)) / totalAmount1.mul(2);
        uint256 exactAmount1 = 
            _amount1.mul(totalAmount0).add(_amount0.mul(totalAmount1)) / totalAmount0.mul(2);
        uint256 calculatedLiquidity = Math.sqrt(exactAmount0.mul(exactAmount1));
        uint256 totalLiquidity = getTotalLiquidity();
        exactLiquidity = 
            calculatedLiquidity.mul(totalLiquidity.sub(MINIMUM_LIQUIDITY)) / totalLiquidity;
    }

    function getLiquidityBalance()
        external
        view
        returns (uint256 balance)
    {
        address pair = Helper.pairFor(factory, token0, token1);
        if (pair == address(0)) return 0;
        balance = IERC20(pair).balanceOf(address(this));
    }

    function addProvision(
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB
    ) external whenNotEnded nonReentrant {
        (address _token0, address _token1) = Helper.sortTokens(tokenA, tokenB);
        require(_token0 == token0 && _token1 == token1, 'INVALID_TOKEN');
        uint256 _amount0 = _token0 == tokenA ? amountA : amountB;
        uint256 _amount1 = _token0 == tokenA ? amountB : amountA;
        require(_amount0 > 0 || _amount1 > 0, 'INVALID_ZERO_AMOUNT');
        UserInfo storage userInfo = _userInfos[msg.sender];
        if (_amount0 > 0) {
            totalAmount0 = totalAmount0.add(_amount0);
            userInfo.amount0 = userInfo.amount0.add(_amount0);
            Helper.safeTransferFrom(
                _token0,
                msg.sender,
                address(this),
                _amount0
            );
        }
        if (_amount1 > 0) {
            totalAmount1 = totalAmount1.add(_amount1);
            userInfo.amount1 = userInfo.amount1.add(_amount1);
            Helper.safeTransferFrom(
                _token1,
                msg.sender,
                address(this),
                _amount1
            );
        }

        emit Provided(msg.sender, _amount0, _amount1);
    }

    function mintLiquidity() 
        external
        whenEndedAndCapped
        nonReentrant
        onlyAdmin
    {
        require(
            IFactory(factory).getPair(token0, token1) == address(0), 
            'PAIR_EXISTS'
        );
        IFactory(factory).createPair(token0, token1);
        address pair = Helper.pairFor(factory, token0, token1);
        Helper.safeTransfer(token0, pair, totalAmount0);
        Helper.safeTransfer(token1, pair, totalAmount1);
        IPair(pair).mint(address(this));
    }

    function claim() 
        external 
        whenEndedAndCapped 
        whenLiquidityMinted
        nonReentrant
    {
        UserInfo storage userInfo = _userInfos[msg.sender];
        require(
            userInfo.amount0 > 0 || userInfo.amount1 > 0, 
            'INSUFFICIENT_AMOUNT'
        );
        uint256 exactLiquidity = getExactLiquidity(msg.sender);
        require(exactLiquidity > 0, 'INSUFFICIENT_LIQUIDITY');
        userInfo.amount0 = 0;
        userInfo.amount1 = 0;
        address pair = Helper.pairFor(factory, token0, token1);
        Helper.safeTransfer(pair, msg.sender, exactLiquidity);
      
        emit LiquidityClaimed(msg.sender, exactLiquidity);
    }

    function refund()
        external
        whenEndedAndFailed
        nonReentrant
    {
        UserInfo storage userInfo = _userInfos[msg.sender];
        require(
            userInfo.amount0 > 0 || userInfo.amount1 > 0, 
            'INSUFFICIENT_AMOUNT'
        );
        uint256 _amount0 = userInfo.amount0;
        uint256 _amount1 = userInfo.amount1;
        if (_amount0 > 0) {
            totalAmount0 = totalAmount0.sub(_amount0);
            userInfo.amount0 = 0;
            Helper.safeTransfer(token0, msg.sender, _amount0);
        }
        if (_amount1 > 0) {
            totalAmount1 = totalAmount1.sub(_amount1);
            userInfo.amount1 = 0;
            Helper.safeTransfer(token1, msg.sender, _amount1);
        }

        emit Refund(msg.sender, _amount0, _amount1);
    }

    function withdraw(
        address token, 
        address to, 
        uint256 amount
    ) external onlyAdmin {
        if (token == token0) {
            uint256 token0Balance = IERC20(token0).balanceOf(address(this));
            require(token0Balance.sub(amount) >= totalAmount0, 'INSUFFICIENT_TOKEN_BALANCE');
        }
        if (token == token1) {
            uint256 token1Balance = IERC20(token1).balanceOf(address(this));
            require(token1Balance.sub(amount) >= totalAmount1, 'INSUFFICIENT_TOKEN_BALANCE');
        }
        Helper.safeTransfer(token, to, amount);

        emit Withdraw(token, to, amount);
    }
}