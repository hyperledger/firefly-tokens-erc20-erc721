// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.6.0;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/utils/Context.sol';

/**
    @dev Mintable+burnable form of ERC20 with data event support.
*/
contract ERC20WithData is Context, ERC20 {
    /**
     * @dev Emitted when `value` tokens are moved from one account (`from`) to
     * another (`to`). This event includes a data field to be emitted with transfers
     *
     * Note that `value` may be zero.
     */
    event TransferWithData(address indexed from, address indexed to, uint256 value, bytes data);

    constructor(string memory name, string memory symbol) public ERC20(name, symbol) {}

    function mintWithData(
        address to,
        uint256 amount,
        bytes calldata data
    ) external virtual {
        _mint(to, amount);
        emit TransferWithData(address(0), to, amount, data);
    }

    function transferWithData(
        address from,
        address to,
        uint256 amount,
        bytes calldata data
    ) external virtual {
        _transfer(from, to, amount);
        emit TransferWithData(from, to, amount, data);
    }

    function burnWithData(address from, uint256 amount, bytes calldata data) external virtual {
        _burn(from, amount);
        emit TransferWithData(from, address(0), amount, data);
    }
}
