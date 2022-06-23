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

export const mockMintWithUriABI: IAbiMethod = {
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
    {
      internalType: 'string',
      name: 'tokenURI_',
      type: 'string',
    },
  ],
  name: 'mintWithURI',
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
      internalType: 'address',
      name: 'from',
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

export const mockTransferEventABI: IAbiMethod = {
  anonymous: false,
  inputs: [
    {
      indexed: true,
      internalType: 'address',
      name: 'from',
      type: 'address',
    },
    {
      indexed: true,
      internalType: 'address',
      name: 'to',
      type: 'address',
    },
    {
      indexed: false,
      internalType: 'uint256',
      name: 'value',
      type: 'uint256',
    },
  ],
  name: 'Transfer',
  type: 'event',
};
