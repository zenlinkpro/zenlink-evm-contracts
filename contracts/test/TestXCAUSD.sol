// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract TestXCAUSD {
    using SafeERC20 for IERC20;

    function tryTransfer(IERC20 token, uint256 amount) external {
        uint256 amountIn = _doTransferIn(token, amount);
        token.safeTransfer(msg.sender, amountIn);
    }


    function _doTransferIn(IERC20 token, uint256 amount) internal returns (uint256) {
        uint256 priorBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        return token.balanceOf(address(this)) - priorBalance;
    }
}
