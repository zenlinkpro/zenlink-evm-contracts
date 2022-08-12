// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

interface ICirculationHelper {
  function getCirculation() external view returns (uint256);

  function getZenlinkTokenWithdrawFeeRatio() external view returns (uint256);
}
