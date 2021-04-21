pragma solidity =0.6.6;

import '@hubdao/core/contracts/interfaces/IHubdaoCallee.sol';

import '../libraries/HubdaoLibrary.sol';
import '../interfaces/V1/IUniswapV1Factory.sol';
import '../interfaces/V1/IUniswapV1Exchange.sol';
import '../interfaces/IHubdaoRouter01.sol';
import '../interfaces/IERC20.sol';
import '../interfaces/IWHT.sol';

contract ExampleFlashSwap is IHubdaoCallee {
    IUniswapV1Factory immutable factoryV1;
    address immutable factory;
    IWHT immutable WHT;

    constructor(address _factory, address _factoryV1, address router) public {
        factoryV1 = IUniswapV1Factory(_factoryV1);
        factory = _factory;
        WHT = IWHT(IHubdaoRouter01(router).WHT());
    }

    // needs to accept HT from any V1 exchange and WHT. ideally this could be enforced, as in the router,
    // but it's not possible because it requires a call to the v1 factory, which takes too much gas
    receive() external payable {}

    // gets tokens/WHT via a V2 flash swap, swaps for the HT/tokens on V1, repays V2, and keeps the rest!
    function hubdaoCall(address sender, uint amount0, uint amount1, bytes calldata data) external override {
        address[] memory path = new address[](2);
        uint amountToken;
        uint amountHT;
        { // scope for token{0,1}, avoids stack too deep errors
        address token0 = IHubdaoPair(msg.sender).token0();
        address token1 = IHubdaoPair(msg.sender).token1();
        assert(msg.sender == HubdaoLibrary.pairFor(factory, token0, token1)); // ensure that msg.sender is actually a V2 pair
        assert(amount0 == 0 || amount1 == 0); // this strategy is unidirectional
        path[0] = amount0 == 0 ? token0 : token1;
        path[1] = amount0 == 0 ? token1 : token0;
        amountToken = token0 == address(WHT) ? amount1 : amount0;
        amountHT = token0 == address(WHT) ? amount0 : amount1;
        }

        assert(path[0] == address(WHT) || path[1] == address(WHT)); // this strategy only works with a V2 WHT pair
        IERC20 token = IERC20(path[0] == address(WHT) ? path[1] : path[0]);
        IUniswapV1Exchange exchangeV1 = IUniswapV1Exchange(factoryV1.getExchange(address(token))); // get V1 exchange

        if (amountToken > 0) {
            (uint minHT) = abi.decode(data, (uint)); // slippage parameter for V1, passed in by caller
            token.approve(address(exchangeV1), amountToken);
            uint amountReceived = exchangeV1.tokenToEthSwapInput(amountToken, minHT, uint(-1));
            uint amountRequired = HubdaoLibrary.getAmountsIn(factory, amountToken, path)[0];
            assert(amountReceived > amountRequired); // fail if we didn't get enough HT back to repay our flash loan
            WHT.deposit{value: amountRequired}();
            assert(WHT.transfer(msg.sender, amountRequired)); // return WHT to V2 pair
            (bool success,) = sender.call{value: amountReceived - amountRequired}(new bytes(0)); // keep the rest! (HT)
            assert(success);
        } else {
            (uint minTokens) = abi.decode(data, (uint)); // slippage parameter for V1, passed in by caller
            WHT.withdraw(amountHT);
            uint amountReceived = exchangeV1.ethToTokenSwapInput{value: amountHT}(minTokens, uint(-1));
            uint amountRequired = HubdaoLibrary.getAmountsIn(factory, amountHT, path)[0];
            assert(amountReceived > amountRequired); // fail if we didn't get enough tokens back to repay our flash loan
            assert(token.transfer(msg.sender, amountRequired)); // return tokens to V2 pair
            assert(token.transfer(sender, amountReceived - amountRequired)); // keep the rest! (tokens)
        }
    }
}
