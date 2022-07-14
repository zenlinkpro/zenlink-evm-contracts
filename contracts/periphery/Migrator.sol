// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IMigrator } from "./interfaces/IMigrator.sol";
import { IRouter } from "./interfaces/IRouter.sol";
import { IFactory } from "../core/interfaces/IFactory.sol";
import { IPair } from "../core/interfaces/IPair.sol";
import { IWNativeCurrency } from "./interfaces/IWNativeCurrency.sol";
import { Helper } from "../libraries/Helper.sol";

contract Migrator is IMigrator {
    using SafeERC20 for IERC20;

    IFactory immutable factoryV1;
    IRouter immutable router;
    address immutable wnative;

    error InvalidMinAmountsParams();

    constructor(IFactory _factoryV1, IRouter _router, address _wnative) {
        factoryV1 = _factoryV1;
        router = _router;
        wnative = _wnative;
    }

    receive() external payable {
        require(msg.sender == wnative);
    }

    function _migrate(IPair pair, uint256 amount0Min, uint256 amount1Min, address to, uint256 deadline) internal {
        {
            uint256 liquidity = IERC20(address(pair)).balanceOf(msg.sender);
            IERC20(address(pair)).safeTransferFrom(msg.sender, address(pair), liquidity);
        }
        address token0 = pair.token0();
        address token1 = pair.token1();
        (uint256 amount0V1, uint256 amount1V1) = pair.burn(address(this));
        IERC20(token0).safeApprove(address(router), amount0V1);
        IERC20(token1).safeApprove(address(router), amount1V1);
        (uint256 amount0V2, uint256 amount1V2, ) = router.addLiquidity(
            token0, 
            token1, 
            amount0V1, 
            amount1V1, 
            amount0Min, 
            amount1Min, 
            to, 
            deadline
        );
        if (amount0V1 > amount0V2) {
            IERC20(token0).safeApprove(address(router), 0);
            _transferBack(token0, amount0V1 - amount0V2, to);
        } else if (amount1V1 > amount1V2) {
            IERC20(token1).safeApprove(address(router), 0);
            _transferBack(token1, amount1V1 - amount1V2, to);
        }
    }

    function _transferBack(address token, uint256 amount, address to) internal {
        if (token == wnative) {
            IWNativeCurrency(wnative).withdraw(amount);
            Helper.safeTransferNativeCurrency(to, amount);
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    function migrate(
        IPair pair, 
        uint256 amount0Min, 
        uint256 amount1Min, 
        address to, 
        uint256 deadline
    ) override external {
        _migrate(pair, amount0Min, amount1Min, to, deadline);
    }

    function migrateMany(
        IPair[] memory pairs, 
        uint256[] memory amounts0Min, 
        uint256[] memory amounts1Min, 
        address to, 
        uint256 deadline
    ) override external {
        uint256 commonLength = pairs.length;
        if (amounts0Min.length != commonLength || amounts1Min.length != commonLength) 
            revert InvalidMinAmountsParams();
        for (uint256 i; i < commonLength; i++) {
            _migrate(pairs[i], amounts0Min[i], amounts1Min[i], to, deadline);
        }
    }
}
