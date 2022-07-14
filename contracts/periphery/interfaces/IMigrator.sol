// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import { IPair } from "../../core/interfaces/IPair.sol";

interface IMigrator {
    function migrate(IPair pair, uint256 amount0Min, uint256 amount1Min, address to, uint256 deadline) external;
    function migrateMany(IPair[] memory pairs, uint256[] memory amounts0Min, uint256[] memory amounts1Min, address to, uint256 deadline) external;
}
