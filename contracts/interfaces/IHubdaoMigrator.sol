pragma solidity >=0.5.0;

interface IHubdaoMigrator {
    function migrate(address token, uint amountTokenMin, uint amountHTMin, address to, uint deadline) external;
}
