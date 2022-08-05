// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./OwnerPausable.sol";
import "./StableSwapStorage.sol";
import "./interfaces/IStableSwap.sol";

contract StableSwap is OwnerPausable, ReentrancyGuard, Initializable, IStableSwap {
    using StableSwapStorage for StableSwapStorage.SwapStorage;
    using SafeERC20 for IERC20;

    /// constants
    uint256 public constant MIN_RAMP_TIME = 1 days;
    uint256 public constant MAX_A = 1e6; // max_a with precision
    uint256 public constant MAX_A_CHANGE = 10;
    uint256 public constant MAX_ADMIN_FEE = 1e10; // 100%
    uint256 public constant MAX_SWAP_FEE = 1e8; // 1%

    /// STATE VARS
    StableSwapStorage.SwapStorage public swapStorage;
    address public feeDistributor;
    address public feeController;
    mapping(address => uint8) public tokenIndexes;

    modifier deadlineCheck(uint256 _deadline) {
        require(block.timestamp <= _deadline, "timeout");
        _;
    }

    modifier onlyFeeControllerOrOwner() {
        require(msg.sender == feeController || msg.sender == admin, "!feeControllerOrOwner");
        _;
    }

    constructor () {
        _initializeAdmin(msg.sender);
    }

    function initialize(
        address[] memory _coins,
        uint8[] memory _decimals,
        string memory lpTokenName,
        string memory lpTokenSymbol,
        uint256 _A,
        uint256 _fee,
        uint256 _adminFee,
        address _feeDistributor
    ) public virtual onlyAdmin initializer {
        require(_coins.length == _decimals.length, "coinsLength != decimalsLength");
        require(_feeDistributor != address(0), "feeDistributor = empty");
        uint256 numberOfCoins = _coins.length;
        uint256[] memory rates = new uint256[](numberOfCoins);
        IERC20[] memory coins = new IERC20[](numberOfCoins);
        for (uint256 i = 0; i < numberOfCoins; i++) {
            require(_coins[i] != address(0), "invalidTokenAddress");
            require(_decimals[i] <= StableSwapStorage.POOL_TOKEN_COMMON_DECIMALS, "invalidDecimals");
            rates[i] = 10**(StableSwapStorage.POOL_TOKEN_COMMON_DECIMALS - _decimals[i]);
            coins[i] = IERC20(_coins[i]);
            tokenIndexes[address(coins[i])] = uint8(i);
        }

        require(_A < MAX_A, "> maxA");
        require(_fee <= MAX_SWAP_FEE, "> maxSwapFee");
        require(_adminFee <= MAX_ADMIN_FEE, "> maxAdminFee");

        swapStorage.lpToken = new LPToken(lpTokenName, lpTokenSymbol);
        swapStorage.balances = new uint256[](numberOfCoins);
        swapStorage.tokenMultipliers = rates;
        swapStorage.pooledTokens = coins;
        swapStorage.initialA = _A * StableSwapStorage.A_PRECISION;
        swapStorage.futureA = _A * StableSwapStorage.A_PRECISION;
        swapStorage.fee = _fee;
        swapStorage.adminFee = _adminFee;
        feeDistributor = _feeDistributor;
    }

    /// PUBLIC FUNCTIONS
    function addLiquidity(
        uint256[] memory amounts,
        uint256 minMintAmount,
        uint256 deadline
    ) external virtual override whenNotPaused nonReentrant deadlineCheck(deadline) returns (uint256) {
        return swapStorage.addLiquidity(amounts, minMintAmount);
    }

    function flashLoan(
        uint256[] memory amountsOut,
        address to,
        bytes calldata data,
        uint256 deadline
    ) external virtual override whenNotPaused nonReentrant deadlineCheck(deadline) {
        swapStorage.flashLoan(amountsOut, to, data);
    }

    function swap(
        uint8 fromIndex,
        uint8 toIndex,
        uint256 inAmount,
        uint256 minOutAmount,
        uint256 deadline
    ) external virtual override whenNotPaused nonReentrant deadlineCheck(deadline) returns (uint256) {
        return swapStorage.swap(fromIndex, toIndex, inAmount, minOutAmount);
    }

    function removeLiquidity(
        uint256 lpAmount,
        uint256[] memory minAmounts,
        uint256 deadline
    ) external virtual override nonReentrant deadlineCheck(deadline) returns (uint256[] memory) {
        return swapStorage.removeLiquidity(lpAmount, minAmounts);
    }

    function removeLiquidityOneToken(
        uint256 lpAmount,
        uint8 index,
        uint256 minAmount,
        uint256 deadline
    ) external virtual override nonReentrant whenNotPaused deadlineCheck(deadline) returns (uint256) {
        return swapStorage.removeLiquidityOneToken(lpAmount, index, minAmount);
    }

    function removeLiquidityImbalance(
        uint256[] memory amounts,
        uint256 maxBurnAmount,
        uint256 deadline
    ) external virtual override nonReentrant whenNotPaused deadlineCheck(deadline) returns (uint256) {
        return swapStorage.removeLiquidityImbalance(amounts, maxBurnAmount);
    }

    /// VIEW FUNCTIONS

    function getVirtualPrice() external virtual view override returns (uint256) {
        return swapStorage.getVirtualPrice();
    }

    function getA() external virtual view override returns (uint256) {
        return swapStorage.getA();
    }

    function getAPrecise() external virtual view override returns (uint256) {
        return swapStorage.getAPrecise();
    }

    function getTokens() external virtual view override returns (IERC20[] memory) {
        return swapStorage.pooledTokens;
    }

    function getToken(uint8 index) external virtual view override returns (IERC20) {
        return swapStorage.pooledTokens[index];
    }

    function getLpToken() external virtual view override returns (IERC20) {
        return swapStorage.lpToken;
    }

    function getTokenIndex(address token) external virtual view override returns (uint8 index) {
        index = tokenIndexes[token];
        require(address(swapStorage.pooledTokens[index]) == token, "tokenNotFound");
    }

    function getTokenPrecisionMultipliers() external virtual view returns (uint256[] memory) {
        return swapStorage.tokenMultipliers;
    }

    function getTokenBalances() external virtual view override returns (uint256[] memory) {
        return swapStorage.balances;
    }

    function getTokenBalance(uint8 index) external virtual view override returns (uint256) {
        return swapStorage.balances[index];
    }

    function getNumberOfTokens() external virtual view override returns (uint256) {
        return swapStorage.pooledTokens.length;
    }

    function getAdminBalances() external virtual view override returns (uint256[] memory adminBalances) {
        uint256 length = swapStorage.pooledTokens.length;
        adminBalances = new uint256[](length);
        for (uint256 i = 0; i < length; i++) {
            adminBalances[i] = swapStorage.getAdminBalance(i);
        }
    }

    function getAdminBalance(uint8 index) external virtual view override returns (uint256) {
        return swapStorage.getAdminBalance((index));
    }

    function calculateTokenAmount(uint256[] calldata amounts, bool deposit) external virtual view override returns (uint256) {
        return swapStorage.calculateTokenAmount(amounts, deposit);
    }

    function calculateSwap(
        uint8 inIndex,
        uint8 outIndex,
        uint256 inAmount
    ) external virtual view override returns (uint256) {
        return swapStorage.calculateSwap(inIndex, outIndex, inAmount);
    }

    function calculateRemoveLiquidity(uint256 amount) external virtual view override returns (uint256[] memory) {
        return swapStorage.calculateRemoveLiquidity(amount);
    }

    function calculateRemoveLiquidityOneToken(uint256 amount, uint8 index) external virtual view override returns (uint256) {
        return swapStorage.calculateRemoveLiquidityOneToken(amount, index);
    }

    /// RESTRICTED FUNCTION

    /**
     * @notice Sets the admin fee
     * @dev adminFee cannot be higher than 100% of the swap fee
     * swap fee cannot be higher than 1% of each swap
     * @param newSwapFee new swap fee to be applied on future transactions
     * @param newAdminFee new admin fee to be applied on future transactions
     */
    function setFee(uint256 newSwapFee, uint256 newAdminFee) external onlyAdmin {
        require(newSwapFee <= MAX_SWAP_FEE, "> maxSwapFee");
        require(newAdminFee <= MAX_ADMIN_FEE, "> maxAdminFee");
        swapStorage.adminFee = newAdminFee;
        swapStorage.fee = newSwapFee;
        emit NewFee(newSwapFee, newAdminFee);
    }

    /**
     * @notice Start ramping up or down A parameter towards given futureA_ and futureTime_
     * Checks if the change is too rapid, and commits the new A value only when it falls under
     * the limit range.
     * @param futureA the new A to ramp towards
     * @param futureATime timestamp when the new A should be reached
     */
    function rampA(uint256 futureA, uint256 futureATime) external onlyAdmin {
        require(block.timestamp >= swapStorage.initialATime + (1 days), "< rampDelay"); // please wait 1 days before start a new ramping
        require(futureATime >= block.timestamp + (MIN_RAMP_TIME), "< minRampTime");
        require(0 < futureA && futureA < MAX_A, "outOfRange");

        uint256 initialAPrecise = swapStorage.getAPrecise();
        uint256 futureAPrecise = futureA * StableSwapStorage.A_PRECISION;

        if (futureAPrecise < initialAPrecise) {
            require(futureAPrecise * (MAX_A_CHANGE) >= initialAPrecise, "> maxChange");
        } else {
            require(futureAPrecise <= initialAPrecise * (MAX_A_CHANGE), "> maxChange");
        }

        swapStorage.initialA = initialAPrecise;
        swapStorage.futureA = futureAPrecise;
        swapStorage.initialATime = block.timestamp;
        swapStorage.futureATime = futureATime;

        emit RampA(initialAPrecise, futureAPrecise, block.timestamp, futureATime);
    }

    function stopRampA() external onlyAdmin {
        require(swapStorage.futureATime > block.timestamp, "alreadyStopped");
        uint256 currentA = swapStorage.getAPrecise();

        swapStorage.initialA = currentA;
        swapStorage.futureA = currentA;
        swapStorage.initialATime = block.timestamp;
        swapStorage.futureATime = block.timestamp;

        emit StopRampA(currentA, block.timestamp);
    }

    function setFeeController(address _feeController) external onlyAdmin {
        require(_feeController != address(0), "zeroAddress");
        feeController = _feeController;
        emit FeeControllerChanged(_feeController);
    }

    function setFeeDistributor(address _feeDistributor) external onlyAdmin {
        require(_feeDistributor != address(0), "zeroAddress");
        feeDistributor = _feeDistributor;
        emit FeeDistributorChanged(_feeDistributor);
    }

    function withdrawAdminFee() external override onlyFeeControllerOrOwner {
        for (uint256 i = 0; i < swapStorage.pooledTokens.length; i++) {
            IERC20 token = swapStorage.pooledTokens[i];
            uint256 balance = token.balanceOf(address(this)) - (swapStorage.balances[i]);
            if (balance != 0) {
                token.safeTransfer(feeDistributor, balance);
                emit CollectProtocolFee(address(token), balance);
            }
        }
    }
}
