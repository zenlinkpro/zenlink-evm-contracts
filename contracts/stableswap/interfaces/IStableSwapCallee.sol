// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IStableSwapCallee {
    function zenlinkStableSwapCall(
        address sender, 
        IERC20[] memory tokens,
        uint256[] memory amounts, 
        uint256[] memory fees, 
        bytes calldata data
    ) external;
}
