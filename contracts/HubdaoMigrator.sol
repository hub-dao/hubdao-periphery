pragma solidity =0.6.6;

import '@hubdao/lib/contracts/libraries/TransferHelper.sol';

import './interfaces/IHubdaoMigrator.sol';
import './interfaces/V1/IUniswapV1Factory.sol';
import './interfaces/V1/IUniswapV1Exchange.sol';
import './interfaces/IHubdaoRouter01.sol';
import './interfaces/IERC20.sol';

contract HubdaoMigrator is IHubdaoMigrator {
    IUniswapV1Factory immutable factoryV1;
    IHubdaoRouter01 immutable router;

    constructor(address _factoryV1, address _router) public {
        factoryV1 = IUniswapV1Factory(_factoryV1);
        router = IHubdaoRouter01(_router);
    }

    // needs to accept HT from any v1 exchange and the router. ideally this could be enforced, as in the router,
    // but it's not possible because it requires a call to the v1 factory, which takes too much gas
    receive() external payable {}

    function migrate(address token, uint amountTokenMin, uint amountHTMin, address to, uint deadline)
        external
        override
    {
        IUniswapV1Exchange exchangeV1 = IUniswapV1Exchange(factoryV1.getExchange(token));
        uint liquidityV1 = exchangeV1.balanceOf(msg.sender);
        require(exchangeV1.transferFrom(msg.sender, address(this), liquidityV1), 'TRANSFER_FROM_FAILED');
        (uint amountHTV1, uint amountTokenV1) = exchangeV1.removeLiquidity(liquidityV1, 1, 1, uint(-1));
        TransferHelper.safeApprove(token, address(router), amountTokenV1);
        (uint amountTokenV2, uint amountHTV2,) = router.addLiquidityHT{value: amountHTV1}(
            token,
            amountTokenV1,
            amountTokenMin,
            amountHTMin,
            to,
            deadline
        );
        if (amountTokenV1 > amountTokenV2) {
            TransferHelper.safeApprove(token, address(router), 0); // be a good blockchain citizen, reset allowance to 0
            TransferHelper.safeTransfer(token, msg.sender, amountTokenV1 - amountTokenV2);
        } else if (amountHTV1 > amountHTV2) {
            // addLiquidityHT guarantees that all of amountHTV1 or amountTokenV1 will be used, hence this else is safe
            TransferHelper.safeTransferHT(msg.sender, amountHTV1 - amountHTV2);
        }
    }
}
