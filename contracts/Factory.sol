pragma solidity >=0.8.0;

import "./interfaces/IFactory.sol";
import "./Pair.sol";

contract Factory is IFactory {
    address public override admin;
    uint8 public override feeBasePoint;

    mapping(address => mapping(address => address)) public override getPair;
    address[] public override allPairs;

    constructor(address _admin) {
        admin = _admin;
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

    function setAdmin(address _admin) external {
        require(msg.sender == admin, "FORBIDDEN");
        admin = _admin;
    }

    function setFeeBasePoint(uint8 _basePoint) external {
        require(msg.sender == admin, "FORBIDDEN");
        require(_basePoint <= 30, "FORBIDDEN");
        feeBasePoint = _basePoint;
    }
}
