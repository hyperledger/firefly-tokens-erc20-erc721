// Methods defined as part of the ERC165 standard
export const SupportsInterface = {
  name: 'supportsInterface',
  type: 'function',
  stateMutability: 'view',
  inputs: [
    {
      internalType: 'bytes4',
      name: 'interfaceId',
      type: 'bytes4',
    },
  ],
  outputs: [
    {
      internalType: 'bool',
      name: '',
      type: 'bool',
    },
  ],
};
