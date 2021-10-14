// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

interface IFactory {
    event PairCreated(
        address indexed token0,
        address indexed token1,
        address pair,
        uint256
    );
    event PairCreateLocked(
        address indexed caller
    );
    event PairCreateUnlock(
        address indexed caller
    );
    event BootstrapSetted(
        address indexed tokenA,
        address indexed tokenB,
        address indexed bootstrap
    );
    event FeetoUpdated(
        address indexed feeto
    );
    event FeeBasePointUpdated(
        uint8 basePoint
    );

    function feeto() external view returns (address);

    function feeBasePoint() external view returns (uint8);

    function lockForPairCreate() external view returns (bool);

    function getPair(address tokenA, address tokenB)
        external
        view
        returns (address pair);
    
    function getBootstrap(address tokenA, address tokenB)
        external
        view
        returns (address bootstrap);

    function allPairs(uint256) external view returns (address pair);

    function allPairsLength() external view returns (uint256);

    function createPair(address tokenA, address tokenB)
        external
        returns (address pair);
}
