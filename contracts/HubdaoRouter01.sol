pragma solidity =0.6.6;

import '@hubdao/core/contracts/interfaces/IHubdaoFactory.sol';
import '@hubdao/lib/contracts/libraries/TransferHelper.sol';

import './libraries/HubdaoLibrary.sol';
import './interfaces/IHubdaoRouter01.sol';
import './interfaces/IERC20.sol';
import './interfaces/IWHT.sol';

contract HubdaoRouter01 is IHubdaoRouter01 {
    address public immutable override factory;
    address public immutable override WHT;

    modifier ensure(uint deadline) {
        require(deadline >= block.timestamp, 'HubdaoRouter: EXPIRED');
        _;
    }

    constructor(address _factory, address _WHT) public {
        factory = _factory;
        WHT = _WHT;
    }

    receive() external payable {
        assert(msg.sender == WHT); // only accept HT via fallback from the WHT contract
    }

    // **** ADD LIQUIDITY ****
    function _addLiquidity(
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin
    ) private returns (uint amountA, uint amountB) {
        // create the pair if it doesn't exist yet
        if (IHubdaoFactory(factory).getPair(tokenA, tokenB) == address(0)) {
            IHubdaoFactory(factory).createPair(tokenA, tokenB);
        }
        (uint reserveA, uint reserveB) = HubdaoLibrary.getReserves(factory, tokenA, tokenB);
        if (reserveA == 0 && reserveB == 0) {
            (amountA, amountB) = (amountADesired, amountBDesired);
        } else {
            uint amountBOptimal = HubdaoLibrary.quote(amountADesired, reserveA, reserveB);
            if (amountBOptimal <= amountBDesired) {
                require(amountBOptimal >= amountBMin, 'HubdaoRouter: INSUFFICIENT_B_AMOUNT');
                (amountA, amountB) = (amountADesired, amountBOptimal);
            } else {
                uint amountAOptimal = HubdaoLibrary.quote(amountBDesired, reserveB, reserveA);
                assert(amountAOptimal <= amountADesired);
                require(amountAOptimal >= amountAMin, 'HubdaoRouter: INSUFFICIENT_A_AMOUNT');
                (amountA, amountB) = (amountAOptimal, amountBDesired);
            }
        }
    }
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external override ensure(deadline) returns (uint amountA, uint amountB, uint liquidity) {
        (amountA, amountB) = _addLiquidity(tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin);
        address pair = HubdaoLibrary.pairFor(factory, tokenA, tokenB);
        TransferHelper.safeTransferFrom(tokenA, msg.sender, pair, amountA);
        TransferHelper.safeTransferFrom(tokenB, msg.sender, pair, amountB);
        liquidity = IHubdaoPair(pair).mint(to);
    }
    function addLiquidityHT(
        address token,
        uint amountTokenDesired,
        uint amountTokenMin,
        uint amountHTMin,
        address to,
        uint deadline
    ) external override payable ensure(deadline) returns (uint amountToken, uint amountHT, uint liquidity) {
        (amountToken, amountHT) = _addLiquidity(
            token,
            WHT,
            amountTokenDesired,
            msg.value,
            amountTokenMin,
            amountHTMin
        );
        address pair = HubdaoLibrary.pairFor(factory, token, WHT);
        TransferHelper.safeTransferFrom(token, msg.sender, pair, amountToken);
        IWHT(WHT).deposit{value: amountHT}();
        assert(IWHT(WHT).transfer(pair, amountHT));
        liquidity = IHubdaoPair(pair).mint(to);
        if (msg.value > amountHT) TransferHelper.safeTransferHT(msg.sender, msg.value - amountHT); // refund dust eth, if any
    }

    // **** REMOVE LIQUIDITY ****
    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) public override ensure(deadline) returns (uint amountA, uint amountB) {
        address pair = HubdaoLibrary.pairFor(factory, tokenA, tokenB);
        IHubdaoPair(pair).transferFrom(msg.sender, pair, liquidity); // send liquidity to pair
        (uint amount0, uint amount1) = IHubdaoPair(pair).burn(to);
        (address token0,) = HubdaoLibrary.sortTokens(tokenA, tokenB);
        (amountA, amountB) = tokenA == token0 ? (amount0, amount1) : (amount1, amount0);
        require(amountA >= amountAMin, 'HubdaoRouter: INSUFFICIENT_A_AMOUNT');
        require(amountB >= amountBMin, 'HubdaoRouter: INSUFFICIENT_B_AMOUNT');
    }
    function removeLiquidityHT(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountHTMin,
        address to,
        uint deadline
    ) public override ensure(deadline) returns (uint amountToken, uint amountHT) {
        (amountToken, amountHT) = removeLiquidity(
            token,
            WHT,
            liquidity,
            amountTokenMin,
            amountHTMin,
            address(this),
            deadline
        );
        TransferHelper.safeTransfer(token, to, amountToken);
        IWHT(WHT).withdraw(amountHT);
        TransferHelper.safeTransferHT(to, amountHT);
    }
    function removeLiquidityWithPermit(
        address tokenA,
        address tokenB,
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline,
        bool approveMax, uint8 v, bytes32 r, bytes32 s
    ) external override returns (uint amountA, uint amountB) {
        address pair = HubdaoLibrary.pairFor(factory, tokenA, tokenB);
        uint value = approveMax ? uint(-1) : liquidity;
        IHubdaoPair(pair).permit(msg.sender, address(this), value, deadline, v, r, s);
        (amountA, amountB) = removeLiquidity(tokenA, tokenB, liquidity, amountAMin, amountBMin, to, deadline);
    }
    function removeLiquidityHTWithPermit(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountHTMin,
        address to,
        uint deadline,
        bool approveMax, uint8 v, bytes32 r, bytes32 s
    ) external override returns (uint amountToken, uint amountHT) {
        address pair = HubdaoLibrary.pairFor(factory, token, WHT);
        uint value = approveMax ? uint(-1) : liquidity;
        IHubdaoPair(pair).permit(msg.sender, address(this), value, deadline, v, r, s);
        (amountToken, amountHT) = removeLiquidityHT(token, liquidity, amountTokenMin, amountHTMin, to, deadline);
    }

    // **** SWAP ****
    // requires the initial amount to have already been sent to the first pair
    function _swap(uint[] memory amounts, address[] memory path, address _to) private {
        for (uint i; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            (address token0,) = HubdaoLibrary.sortTokens(input, output);
            uint amountOut = amounts[i + 1];
            (uint amount0Out, uint amount1Out) = input == token0 ? (uint(0), amountOut) : (amountOut, uint(0));
            address to = i < path.length - 2 ? HubdaoLibrary.pairFor(factory, output, path[i + 2]) : _to;
            IHubdaoPair(HubdaoLibrary.pairFor(factory, input, output)).swap(amount0Out, amount1Out, to, new bytes(0));
        }
    }
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external override ensure(deadline) returns (uint[] memory amounts) {
        amounts = HubdaoLibrary.getAmountsOut(factory, amountIn, path);
        require(amounts[amounts.length - 1] >= amountOutMin, 'HubdaoRouter: INSUFFICIENT_OUTPUT_AMOUNT');
        TransferHelper.safeTransferFrom(path[0], msg.sender, HubdaoLibrary.pairFor(factory, path[0], path[1]), amounts[0]);
        _swap(amounts, path, to);
    }
    function swapTokensForExactTokens(
        uint amountOut,
        uint amountInMax,
        address[] calldata path,
        address to,
        uint deadline
    ) external override ensure(deadline) returns (uint[] memory amounts) {
        amounts = HubdaoLibrary.getAmountsIn(factory, amountOut, path);
        require(amounts[0] <= amountInMax, 'HubdaoRouter: EXCESSIVE_INPUT_AMOUNT');
        TransferHelper.safeTransferFrom(path[0], msg.sender, HubdaoLibrary.pairFor(factory, path[0], path[1]), amounts[0]);
        _swap(amounts, path, to);
    }
    function swapExactHTForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline)
        external
        override
        payable
        ensure(deadline)
        returns (uint[] memory amounts)
    {
        require(path[0] == WHT, 'HubdaoRouter: INVALID_PATH');
        amounts = HubdaoLibrary.getAmountsOut(factory, msg.value, path);
        require(amounts[amounts.length - 1] >= amountOutMin, 'HubdaoRouter: INSUFFICIENT_OUTPUT_AMOUNT');
        IWHT(WHT).deposit{value: amounts[0]}();
        assert(IWHT(WHT).transfer(HubdaoLibrary.pairFor(factory, path[0], path[1]), amounts[0]));
        _swap(amounts, path, to);
    }
    function swapTokensForExactHT(uint amountOut, uint amountInMax, address[] calldata path, address to, uint deadline)
        external
        override
        ensure(deadline)
        returns (uint[] memory amounts)
    {
        require(path[path.length - 1] == WHT, 'HubdaoRouter: INVALID_PATH');
        amounts = HubdaoLibrary.getAmountsIn(factory, amountOut, path);
        require(amounts[0] <= amountInMax, 'HubdaoRouter: EXCESSIVE_INPUT_AMOUNT');
        TransferHelper.safeTransferFrom(path[0], msg.sender, HubdaoLibrary.pairFor(factory, path[0], path[1]), amounts[0]);
        _swap(amounts, path, address(this));
        IWHT(WHT).withdraw(amounts[amounts.length - 1]);
        TransferHelper.safeTransferHT(to, amounts[amounts.length - 1]);
    }
    function swapExactTokensForHT(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline)
        external
        override
        ensure(deadline)
        returns (uint[] memory amounts)
    {
        require(path[path.length - 1] == WHT, 'HubdaoRouter: INVALID_PATH');
        amounts = HubdaoLibrary.getAmountsOut(factory, amountIn, path);
        require(amounts[amounts.length - 1] >= amountOutMin, 'HubdaoRouter: INSUFFICIENT_OUTPUT_AMOUNT');
        TransferHelper.safeTransferFrom(path[0], msg.sender, HubdaoLibrary.pairFor(factory, path[0], path[1]), amounts[0]);
        _swap(amounts, path, address(this));
        IWHT(WHT).withdraw(amounts[amounts.length - 1]);
        TransferHelper.safeTransferHT(to, amounts[amounts.length - 1]);
    }
    function swapHTForExactTokens(uint amountOut, address[] calldata path, address to, uint deadline)
        external
        override
        payable
        ensure(deadline)
        returns (uint[] memory amounts)
    {
        require(path[0] == WHT, 'HubdaoRouter: INVALID_PATH');
        amounts = HubdaoLibrary.getAmountsIn(factory, amountOut, path);
        require(amounts[0] <= msg.value, 'HubdaoRouter: EXCESSIVE_INPUT_AMOUNT');
        IWHT(WHT).deposit{value: amounts[0]}();
        assert(IWHT(WHT).transfer(HubdaoLibrary.pairFor(factory, path[0], path[1]), amounts[0]));
        _swap(amounts, path, to);
        if (msg.value > amounts[0]) TransferHelper.safeTransferHT(msg.sender, msg.value - amounts[0]); // refund dust eth, if any
    }

    function quote(uint amountA, uint reserveA, uint reserveB) public pure override returns (uint amountB) {
        return HubdaoLibrary.quote(amountA, reserveA, reserveB);
    }

    function getAmountOut(uint amountIn, uint reserveIn, uint reserveOut) public pure override returns (uint amountOut) {
        return HubdaoLibrary.getAmountOut(amountIn, reserveIn, reserveOut);
    }

    function getAmountIn(uint amountOut, uint reserveIn, uint reserveOut) public pure override returns (uint amountIn) {
        return HubdaoLibrary.getAmountOut(amountOut, reserveIn, reserveOut);
    }

    function getAmountsOut(uint amountIn, address[] memory path) public view override returns (uint[] memory amounts) {
        return HubdaoLibrary.getAmountsOut(factory, amountIn, path);
    }

    function getAmountsIn(uint amountOut, address[] memory path) public view override returns (uint[] memory amounts) {
        return HubdaoLibrary.getAmountsIn(factory, amountOut, path);
    }
}
