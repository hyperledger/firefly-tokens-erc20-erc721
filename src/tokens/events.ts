export const ERC20Transfer = {
  name: 'Transfer',
  type: 'event',
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
};

export const ERC20Approval = {
  name: 'Approval',
  type: 'event',
  inputs: [
    {
      indexed: true,
      internalType: 'address',
      name: 'owner',
      type: 'address',
    },
    {
      indexed: true,
      internalType: 'address',
      name: 'spender',
      type: 'address',
    },
    {
      indexed: false,
      internalType: 'uint256',
      name: 'value',
      type: 'uint256',
    },
  ],
};

export const ERC721Transfer = {
  name: 'Transfer',
  type: 'event',
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
      indexed: true,
      internalType: 'uint256',
      name: 'tokenId',
      type: 'uint256',
    },
  ],
};

export const ERC721Approval = {
  name: 'Approval',
  type: 'event',
  anonymous: false,
  inputs: [
    {
      indexed: true,
      internalType: 'address',
      name: 'owner',
      type: 'address',
    },
    {
      indexed: true,
      internalType: 'address',
      name: 'approved',
      type: 'address',
    },
    {
      indexed: true,
      internalType: 'uint256',
      name: 'tokenId',
      type: 'uint256',
    },
  ],
};

export const ERC721ApprovalForAll = {
  name: 'ApprovalForAll',
  type: 'event',
  anonymous: false,
  inputs: [
    {
      indexed: true,
      internalType: 'address',
      name: 'owner',
      type: 'address',
    },
    {
      indexed: true,
      internalType: 'address',
      name: 'operator',
      type: 'address',
    },
    {
      indexed: false,
      internalType: 'bool',
      name: 'approved',
      type: 'bool',
    },
  ],
};

export const ERC20Events = [ERC20Transfer, ERC20Approval];
export const ERC721Events = [ERC721Transfer, ERC721Approval, ERC721ApprovalForAll];
