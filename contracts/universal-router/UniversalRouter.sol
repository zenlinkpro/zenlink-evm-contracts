// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {InputStream} from './InputStream.sol';
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {SafeTransferLib} from 'lib/solmate/src/utils/SafeTransferLib.sol';
import {IPair} from "../core/interfaces/IPair.sol";
import {IWETH} from "./interfaces/IWETH.sol";
import {IStableSwapDispatcher} from "./interfaces/IStableSwapDispatcher.sol";

address constant NATIVE_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

contract UniversalRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeTransferLib for address;
    using InputStream for uint256;

    error InvalidCommandCode(uint8 code);
    error WrongAmountInValue(uint256 accAmount, uint256 amountIn);
    error InsufficientOutAmount();
    error InvalidPool(address pool);

    IStableSwapDispatcher public immutable stableSwapDispatcher;
    
    constructor(IStableSwapDispatcher _stableSwapDispatcher) {
        stableSwapDispatcher = _stableSwapDispatcher;
    }

    /// @notice To receive ETH from WETH
    receive() external payable {}

    /// @notice Decodes and executes the given route
    /// @param tokenIn Address of the input token
    /// @param amountIn Amount of the input token
    /// @param tokenOut Address of the output token
    /// @param amountOutMin Minimum amount of the output token
    /// @param to Receiver address
    /// @param route The encoded route to execute with
    /// @return amountOut Actual amount of the output token
    function processRoute(
        address tokenIn,
        uint256 amountIn,
        address tokenOut,
        uint256 amountOutMin,
        address to,
        bytes memory route
    ) external payable nonReentrant returns (uint256 amountOut) {
        return processRouteInternal(tokenIn, amountIn, tokenOut, amountOutMin, to, route);
    }

    /// @notice Decodes and executes the given route
    /// @param tokenIn Address of the input token
    /// @param amountIn Amount of the input token
    /// @param tokenOut Address of the output token
    /// @param amountOutMin Minimum amount of the output token
    /// @param to Receiver address
    /// @param route The encoded route to execute with
    /// @return amountOut Actual amount of the output token
    function processRouteInternal(
        address tokenIn,
        uint256 amountIn,
        address tokenOut,
        uint256 amountOutMin,
        address to,
        bytes memory route
    ) private returns (uint256 amountOut) {
        uint256 amountInAcc = 0;
        uint256 balanceInitial = tokenOut == NATIVE_ADDRESS ? 
            address(to).balance 
            : IERC20(tokenOut).balanceOf(to);

        uint256 stream = InputStream.createStream(route);
        while (stream.isNotEmpty()) {
            uint8 commandCode = stream.readUint8();
            if (commandCode < 20) {
                if (commandCode == 10) {
                    // UniswapV2 pool swap
                    swapUniswapV2Pool(stream);
                } else if (commandCode == 4) {
                    // distribute ERC20 tokens from this router to pools
                    distributeERC20Shares(stream);
                } else if (commandCode == 3) {
                    // initial distribution
                    amountInAcc += distributeERC20Amounts(stream, tokenIn);
                } else if (commandCode == 5) {
                    // wrap natives and initial distribution 
                    amountInAcc += wrapAndDistributeERC20Amounts(stream, amountIn);
                } else if (commandCode == 6) {
                    // unwrap natives
                    unwrapNative(to, stream);
                } else {    
                    revert InvalidCommandCode(commandCode);
                }
            } else if (commandCode < 24) {
                if (commandCode == 20) {
                    // Zenlink stable pool swap
                    swapZenlinkStableSwap(stream);
                } else {
                    revert InvalidCommandCode(commandCode);
                }
            } else {
                revert InvalidCommandCode(commandCode);
            }
        }

        if (amountInAcc != amountIn) revert WrongAmountInValue(amountInAcc, amountIn);
            
        uint256 balanceFinal = tokenOut == NATIVE_ADDRESS ? 
            address(to).balance 
            : IERC20(tokenOut).balanceOf(to);
        if (balanceFinal < balanceInitial + amountOutMin) revert InsufficientOutAmount();
        amountOut = balanceFinal - balanceInitial;
    }

    /// @notice Performs a UniswapV2 pool swap
    /// @param stream [Pool, TokenIn, Direction, To]
    /// @return amountOut Amount of the output token
    function swapUniswapV2Pool(uint256 stream) private returns (uint256 amountOut) {
        address pool = stream.readAddress();
        address tokenIn = stream.readAddress();
        uint8 direction = stream.readUint8();
        address to = stream.readAddress();

        (uint256 reserve0, uint256 reserve1, ) = IPair(pool).getReserves();
        if (reserve0 == 0 || reserve1 == 0) revert InvalidPool(pool);
        (uint256 reserveIn, uint256 reserveOut) = direction == 1 
            ? (reserve0, reserve1) 
            : (reserve1, reserve0);

        uint256 amountIn = IERC20(tokenIn).balanceOf(pool) - reserveIn;
        uint256 amountInWithFee = amountIn * 997;
        amountOut = (amountInWithFee * reserveOut) / (reserveIn * 1000 + amountInWithFee);
        (uint256 amount0Out, uint256 amount1Out) = direction == 1 
            ? (uint256(0), amountOut) 
            : (amountOut, uint256(0));

        IPair(pool).swap(amount0Out, amount1Out, to, new bytes(0));
    }

    /// @notice Performs a Zenlink stable pool swap
    /// @param stream [Pool, To, [TokenIn, TokenOut]]
    function swapZenlinkStableSwap(uint256 stream) private {
        address pool = stream.readAddress();
        address to = stream.readAddress();
        bytes memory swapData = stream.readBytes();
        (address tokenIn, address tokenOut) = abi.decode(swapData, (address, address));
    
        stableSwapDispatcher.swap(pool, tokenIn, tokenOut, to);
    }

    /// @notice Distributes input ERC20 tokens from msg.sender to addresses. Tokens should be approved
    /// @param stream [ArrayLength, ...[To, Amount][]]. An array of destinations and token amounts
    /// @param token Token to distribute
    /// @return amountTotal Total amount distributed
    function distributeERC20Amounts(uint256 stream, address token) private returns (uint256 amountTotal) {
        uint8 num = stream.readUint8();
        amountTotal = 0;
        for (uint256 i = 0; i < num; ++i) {
            address to = stream.readAddress();
            uint256 amount = stream.readUint();
            amountTotal += amount;
            IERC20(token).safeTransferFrom(msg.sender, to, amount);
        }
    }

    /// @notice Wraps all native inputs and distributes wrapped ERC20 tokens from router to addresses
    /// @param stream [WrapToken, ArrayLength, ...[To, Amount][]]. An array of destinations and token amounts
    /// @return amountTotal Total amount distributed
    function wrapAndDistributeERC20Amounts(uint256 stream, uint256 amountIn) private returns (uint256 amountTotal) {
        address token = stream.readAddress();
        IWETH(token).deposit{value: amountIn}();
        uint8 num = stream.readUint8();
        amountTotal = 0;
        for (uint256 i = 0; i < num; ++i) {
            address to = stream.readAddress();
            uint256 amount = stream.readUint();
            amountTotal += amount;
            IERC20(token).safeTransfer(to, amount);
        }
    }

    /// @notice Distributes ERC20 tokens from router to addresses
    /// @notice Quantity for sending is determined by share in 1/65535
    /// @notice During routing we can't predict in advance the actual value of internal swaps because of slippage,
    /// @notice so we have to work with shares - not fixed amounts
    /// @param stream [Token, ArrayLength, ...[To, ShareAmount][]]. Token to distribute. An array of destinations and token share amounts
    function distributeERC20Shares(uint256 stream) private {
        address token = stream.readAddress();
        uint8 num = stream.readUint8();
        // slot undrain protection
        uint256 amountTotal = IERC20(token).balanceOf(address(this)) - 1;     

        for (uint256 i = 0; i < num; ++i) {
            address to = stream.readAddress();
            uint16 share = stream.readUint16();
            uint256 amount = (amountTotal * share) / 65535;
            amountTotal -= amount;
            IERC20(token).safeTransfer(to, amount);
        }
    }

    /// @notice Unwraps the Native Token
    /// @param receiver Destination of the unwrapped token
    /// @param stream [Token]. Token to unwrap native
    function unwrapNative(address receiver, uint256 stream) private {
        address token = stream.readAddress();
        uint256 amount = IERC20(token).balanceOf(address(this)) - 1;
        // slot undrain protection
        IWETH(token).withdraw(amount);     
        receiver.safeTransferETH(amount);
    }
}
