// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IStellarPool} from "./interfaces/IStellarPool.sol";

/// @title StellarPool
/// @author Vladimir Radev
/// @notice Constant-product (x * y = k) ETH/VLAD AMM with a 0.30% swap fee. The contract itself is the LP token (sLP).
/// @dev Reserves are tracked in storage and never read from balances, so donated tokens or force-sent ETH do not
///      move the price. There is no receive()/fallback: plain ETH transfers revert.
contract StellarPool is ERC20, ReentrancyGuard, IStellarPool {
    using SafeERC20 for IERC20;

    uint256 public constant FEE_BPS = 30;
    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    /// @dev OpenZeppelin v5 forbids minting to address(0), so the permanently locked liquidity goes here.
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    IERC20 public immutable vlad;
    uint256 public reserveEth;
    uint256 public reserveVlad;
    uint256 public lastUpdateBlock;

    event Mint(address indexed to, uint256 ethIn, uint256 vladIn, uint256 lp);
    event Burn(address indexed to, uint256 ethOut, uint256 vladOut, uint256 lp);
    event Swap(address indexed trader, uint256 ethIn, uint256 vladIn, uint256 ethOut, uint256 vladOut);
    event Sync(uint256 reserveEth, uint256 reserveVlad);

    error ZeroAmount();
    error Slippage();
    error InsufficientLiquidity();
    error EthTransferFailed();

    constructor(IERC20 vlad_) ERC20("Stellar VLAD-ETH LP", "sLP") {
        vlad = vlad_;
    }

    /// @notice Deposits `msg.value` ETH plus the matching VLAD and mints LP tokens to the caller.
    /// @dev First deposit sets the price and pulls all of `maxVlad`; later deposits pull the proportional amount,
    ///      rounded up in the pool's favour, and revert if that exceeds `maxVlad`.
    function addLiquidity(uint256 maxVlad, uint256 minLp) external payable nonReentrant returns (uint256 lp) {
        if (msg.value == 0 || maxVlad == 0) revert ZeroAmount();
        uint256 supply = totalSupply();
        uint256 vladIn;
        if (supply == 0) {
            vladIn = maxVlad;
            uint256 root = Math.sqrt(msg.value * maxVlad);
            if (root <= MINIMUM_LIQUIDITY) revert InsufficientLiquidity();
            lp = root - MINIMUM_LIQUIDITY;
            _mint(DEAD, MINIMUM_LIQUIDITY);
        } else {
            vladIn = Math.mulDiv(msg.value, reserveVlad, reserveEth, Math.Rounding.Ceil);
            if (vladIn > maxVlad) revert Slippage();
            lp = msg.value * supply / reserveEth;
        }
        if (lp == 0) revert InsufficientLiquidity();
        if (lp < minLp) revert Slippage();
        _mint(msg.sender, lp);
        _update(reserveEth + msg.value, reserveVlad + vladIn);
        emit Mint(msg.sender, msg.value, vladIn, lp);
        vlad.safeTransferFrom(msg.sender, address(this), vladIn);
    }

    /// @notice Burns `lp` and returns the caller's pro-rata share of both reserves. ETH is sent last.
    function removeLiquidity(uint256 lp, uint256 minEth, uint256 minVlad)
        external
        nonReentrant
        returns (uint256 ethOut, uint256 vladOut)
    {
        if (lp == 0) revert ZeroAmount();
        uint256 supply = totalSupply();
        ethOut = lp * reserveEth / supply;
        vladOut = lp * reserveVlad / supply;
        if (ethOut == 0 || vladOut == 0) revert InsufficientLiquidity();
        if (ethOut < minEth || vladOut < minVlad) revert Slippage();
        _burn(msg.sender, lp);
        _update(reserveEth - ethOut, reserveVlad - vladOut);
        emit Burn(msg.sender, ethOut, vladOut, lp);
        vlad.safeTransfer(msg.sender, vladOut);
        _sendEth(msg.sender, ethOut);
    }

    /// @notice Sells `msg.value` ETH for at least `minVladOut` VLAD.
    function swapEthForVlad(uint256 minVladOut) external payable nonReentrant returns (uint256 vladOut) {
        if (msg.value == 0) revert ZeroAmount();
        vladOut = getAmountOut(msg.value, reserveEth, reserveVlad);
        if (vladOut == 0 || vladOut < minVladOut) revert Slippage();
        _update(reserveEth + msg.value, reserveVlad - vladOut);
        emit Swap(msg.sender, msg.value, 0, 0, vladOut);
        vlad.safeTransfer(msg.sender, vladOut);
    }

    /// @notice Sells `vladIn` VLAD (pre-approved) for at least `minEthOut` ETH. ETH is sent last.
    function swapVladForEth(uint256 vladIn, uint256 minEthOut) external nonReentrant returns (uint256 ethOut) {
        if (vladIn == 0) revert ZeroAmount();
        ethOut = getAmountOut(vladIn, reserveVlad, reserveEth);
        if (ethOut == 0 || ethOut < minEthOut) revert Slippage();
        _update(reserveEth - ethOut, reserveVlad + vladIn);
        emit Swap(msg.sender, 0, vladIn, ethOut, 0);
        vlad.safeTransferFrom(msg.sender, address(this), vladIn);
        _sendEth(msg.sender, ethOut);
    }

    /// @notice Output for `amountIn` after the 0.30% fee: amountIn*9970*reserveOut / (reserveIn*10000 + amountIn*9970).
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) public pure returns (uint256) {
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();
        uint256 amountInWithFee = amountIn * (10_000 - FEE_BPS);
        return Math.mulDiv(amountInWithFee, reserveOut, reserveIn * 10_000 + amountInWithFee);
    }

    /// @notice VLAD that `addLiquidity` would pull for `ethIn` and the LP it would mint. Returns (0, 0) while the
    ///         pool is empty, because the first depositor chooses the price.
    function quoteAddLiquidity(uint256 ethIn) external view returns (uint256 vladNeeded, uint256 lpOut) {
        uint256 supply = totalSupply();
        if (supply == 0) return (0, 0);
        vladNeeded = Math.mulDiv(ethIn, reserveVlad, reserveEth, Math.Rounding.Ceil);
        lpOut = ethIn * supply / reserveEth;
    }

    /// @inheritdoc IStellarPool
    function getReserves() external view returns (uint256 ethReserve, uint256 vladReserve) {
        return (reserveEth, reserveVlad);
    }

    function _update(uint256 newReserveEth, uint256 newReserveVlad) private {
        reserveEth = newReserveEth;
        reserveVlad = newReserveVlad;
        lastUpdateBlock = block.number;
        emit Sync(newReserveEth, newReserveVlad);
    }

    function _sendEth(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert EthTransferFailed();
    }
}
