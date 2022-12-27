import { BadRequestException } from '@nestjs/common';
import {
  MethodSignature,
  TokenOperation,
  TokenApproval,
  TokenBurn,
  TokenMint,
  TokenTransfer,
} from './tokens.interfaces';
import { encodeHex } from './tokens.util';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// Methods defined as part of the ERC721 standard
// Although these are "optional" in the standard, they are currently
// required by this connector.

export const Name = {
  name: 'name',
  type: 'function',
  stateMutability: 'view',
  inputs: [],
  outputs: [
    {
      internalType: 'string',
      name: '',
      type: 'string',
    },
  ],
};

export const Symbol = {
  name: 'symbol',
  type: 'function',
  stateMutability: 'view',
  inputs: [],
  outputs: [
    {
      internalType: 'string',
      name: '',
      type: 'string',
    },
  ],
};

export const TokenURI = {
  name: 'tokenURI',
  type: 'function',
  stateMutability: 'view',
  inputs: [
    {
      internalType: 'uint256',
      name: 'tokenId',
      type: 'uint256',
    },
  ],
  outputs: [
    {
      internalType: 'string',
      name: '',
      type: 'string',
    },
  ],
};

// Events defined as part of the ERC721 standard

export const Transfer = {
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

export const Approval = {
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

export const ApprovalForAll = {
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

export const AllEvents = [Transfer, Approval, ApprovalForAll];

// Methods which have many possible forms
// These may include extensions defined by FireFly, extensions defined by
// OpenZeppelin, and methods that are part of the base standard.
// Each operation type is a prioritized list of methods to be used if defined.

export const DynamicMethods: Record<TokenOperation, MethodSignature[]> = {
  approve: [
    {
      name: 'approveWithData',
      inputs: [{ type: 'address' }, { type: 'uint256' }, { type: 'bytes' }],
      map: (dto: TokenApproval) => {
        if (dto.config?.tokenIndex !== undefined) {
          // Token index must be set
          return [
            dto.approved ? dto.operator : ZERO_ADDRESS,
            dto.config.tokenIndex,
            encodeHex(dto.data ?? ''),
          ];
        }
        return undefined;
      },
    },
    {
      name: 'setApprovalForAllWithData',
      inputs: [{ type: 'address' }, { type: 'bool' }, { type: 'bytes' }],
      map: (dto: TokenApproval) => {
        if (dto.config?.tokenIndex === undefined) {
          // Token index must not be set
          return [dto.operator, dto.approved, encodeHex(dto.data ?? '')];
        }
        return undefined;
      },
    },
    {
      name: 'approve',
      inputs: [{ type: 'address' }, { type: 'uint256' }],
      map: (dto: TokenApproval) => {
        if (dto.config?.tokenIndex !== undefined) {
          // Token index must be set
          return [dto.approved ? dto.operator : ZERO_ADDRESS, dto.config.tokenIndex];
        }
        return undefined;
      },
    },
    {
      name: 'setApprovalForAll',
      inputs: [{ type: 'address' }, { type: 'bool' }],
      map: (dto: TokenApproval) => {
        if (dto.config?.tokenIndex === undefined) {
          // Token index must not be set
          return [dto.operator, dto.approved];
        }
        return undefined;
      },
    },
  ],

  burn: [
    {
      name: 'burnWithData',
      inputs: [{ type: 'address' }, { type: 'uint256' }, { type: 'bytes' }],
      map: (dto: TokenBurn) => {
        return [dto.from, getTokenID(dto), encodeHex(dto.data ?? '')];
      },
    },
    {
      name: 'burn',
      inputs: [{ type: 'address' }, { type: 'uint256' }],
      map: (dto: TokenBurn) => {
        return [dto.from, getTokenID(dto)];
      },
    },
  ],

  mint: [
    {
      name: 'mintWithURI',
      inputs: [{ type: 'address' }, { type: 'uint256' }, { type: 'bytes' }, { type: 'string' }],
      map: (dto: TokenMint) => {
        return [dto.to, getTokenID(dto), encodeHex(dto.data ?? ''), dto.uri];
      },
    },
    {
      name: 'mintWithData',
      inputs: [{ type: 'address' }, { type: 'uint256' }, { type: 'bytes' }],
      map: (dto: TokenMint) => {
        return [dto.to, getTokenID(dto), encodeHex(dto.data ?? '')];
      },
    },
    {
      name: 'mint',
      inputs: [{ type: 'address' }, { type: 'uint256' }],
      map: (dto: TokenMint) => {
        return [dto.to, getTokenID(dto)];
      },
    },
  ],

  transfer: [
    {
      name: 'transferWithData',
      inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'bytes' }],
      map: (dto: TokenTransfer) => {
        return [dto.from, dto.to, getTokenID(dto), encodeHex(dto.data ?? '')];
      },
    },
    {
      name: 'safeTransferFrom',
      inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }],
      map: (dto: TokenTransfer) => {
        return [dto.from, dto.to, getTokenID(dto)];
      },
    },
  ],
};

function getTokenID(dto: TokenMint | TokenTransfer | TokenBurn): string | undefined {
  if (dto.amount !== undefined && dto.amount !== '1') {
    throw new BadRequestException('Amount for nonfungible tokens must be 1');
  }
  return dto.tokenIndex;
}
