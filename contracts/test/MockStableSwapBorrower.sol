// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import {IStableSwapCallee} from "../stableswap/interfaces/IStableSwapCallee.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockStableSwapBorrower {
    using SafeERC20 for IERC20;

    function zenlinkStableSwapCall(
        address sender, 
        IERC20[] memory tokens,
        uint256[] memory amounts, 
        uint256[] memory fees, 
        bytes calldata data
    ) external {
        require(data.length > 0);

        for (uint256 i = 0; i < amounts.length; i++) {
            if (amounts[i] > 0) {
                tokens[i].safeTransferFrom(sender, address(this), fees[i]);
                tokens[i].safeIncreaseAllowance(msg.sender, amounts[i] + fees[i]);
            }
        }
    }
}
