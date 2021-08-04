// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import "./interfaces/IFactory.sol";
import "./Pair.sol";
import "../libraries/AdminUpgradeable.sol";

contract Factory is AdminUpgradeable, IFactory {
    address public override feeto;
    uint8 public override feeBasePoint;

    mapping(address => mapping(address => address)) public override getPair;
    address[] public override allPairs;

    constructor(address _admin) {
        _initializeAdmin(_admin);
        feeto = _admin;
    }

    function allPairsLength() external view override returns (uint256) {
        return allPairs.length;
    }

    function createPair(address tokenA, address tokenB)
        external
        override
        returns (address pair)
    {
        require(tokenA != tokenB, "IDENTICAL_ADDRESSES");
        (address token0, address token1) = tokenA < tokenB
            ? (tokenA, tokenB)
            : (tokenB, tokenA);
        require(token0 != address(0), "ZERO_ADDRESS");
        require(getPair[token0][token1] == address(0), "Factory: PAIR_EXISTS");
        bytes memory bytecode = type(Pair).creationCode;
        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        assembly {
            pair := create2(0, add(bytecode, 32), mload(bytecode), salt)
        }
        IPair(pair).initialize(token0, token1);
        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair;
        allPairs.push(pair);
        emit PairCreated(token0, token1, pair, allPairs.length);
    }

    function setFeeto(address _feeto) external onlyAdmin {
        feeto = _feeto;
    }

    function setFeeBasePoint(uint8 _basePoint) external onlyAdmin {
        require(_basePoint <= 30, "FORBIDDEN");
        feeBasePoint = _basePoint;
    }

    function lockPairMint(address tokenA, address tokenB) external onlyAdmin {
        address pair = getPair[tokenA][tokenB];
        IPair(pair).lockMint();
    }

    function unlockPairMint(address tokenA, address tokenB) external onlyAdmin {
        address pair = getPair[tokenA][tokenB];
        IPair(pair).unlockMint();
    }

    function lockPairBurn(address tokenA, address tokenB) external onlyAdmin {
        address pair = getPair[tokenA][tokenB];
        IPair(pair).lockBurn();
    }

    function unlockPairBurn(address tokenA, address tokenB) external onlyAdmin {
        address pair = getPair[tokenA][tokenB];
        IPair(pair).unlockBurn();
    }

    function lockPairSwap(address tokenA, address tokenB) external onlyAdmin {
        address pair = getPair[tokenA][tokenB];
        IPair(pair).lockSwap();
    }

    function unlockPairSwap(address tokenA, address tokenB) external onlyAdmin {
        address pair = getPair[tokenA][tokenB];
        IPair(pair).unlockSwap();
    }
}
