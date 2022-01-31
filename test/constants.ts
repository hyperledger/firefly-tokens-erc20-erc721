import { IAbiMethod } from '../src/tokens/tokens.interfaces';

export const mockMintWithDataABI: IAbiMethod = {
  inputs: [
    {
      internalType: 'address',
      name: 'to',
      type: 'address',
    },
    {
      internalType: 'uint256',
      name: 'amount',
      type: 'uint256',
    },
    {
      internalType: 'bytes',
      name: 'data',
      type: 'bytes',
    },
  ],
  name: 'mintWithData',
  outputs: [],
  stateMutability: 'nonpayable',
  type: 'function',
};

export const mockTransferWithDataABI: IAbiMethod = {
  inputs: [
    {
      internalType: 'address',
      name: 'from',
      type: 'address',
    },
    {
      internalType: 'address',
      name: 'to',
      type: 'address',
    },
    {
      internalType: 'uint256',
      name: 'amount',
      type: 'uint256',
    },
    {
      internalType: 'bytes',
      name: 'data',
      type: 'bytes',
    },
  ],
  name: 'transferWithData',
  outputs: [],
  stateMutability: 'nonpayable',
  type: 'function',
};

export const mockBurnWithDataABI: IAbiMethod = {
  inputs: [
    {
      internalType: 'uint256',
      name: 'amount',
      type: 'uint256',
    },
    {
      internalType: 'bytes',
      name: 'data',
      type: 'bytes',
    },
  ],
  name: 'burnWithData',
  outputs: [],
  stateMutability: 'nonpayable',
  type: 'function',
};

export const mockBalanceOfABI: IAbiMethod = {
  inputs: [
    {
      internalType: 'address',
      name: 'account',
      type: 'address',
    },
  ],
  name: 'balanceOf',
  outputs: [
    {
      internalType: 'uint256',
      name: '',
      type: 'uint256',
    },
  ],
  stateMutability: 'view',
  type: 'function',
};
