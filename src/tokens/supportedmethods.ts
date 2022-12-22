import { BadRequestException } from '@nestjs/common';
import { TokenApproval, TokenBurn, TokenMint, TokenTransfer, TokenType } from './tokens.interfaces';
import { encodeHex } from './tokens.util';

const UINT256_MAX = BigInt(2) ** BigInt(256) - BigInt(1);
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export interface MethodSignature {
  name: string;
  inputs: { name: string; type: string }[];
  map: (dto: any) => any[] | undefined;
}

function getAmountOrTokenID(
  dto: TokenMint | TokenTransfer | TokenBurn,
  type: TokenType,
): string | undefined {
  if (type === TokenType.FUNGIBLE) {
    return dto.amount;
  }

  if (dto.amount !== undefined && dto.amount !== '1') {
    throw new BadRequestException('Amount for nonfungible tokens must be 1');
  }

  return dto.tokenIndex;
}

export type OpTypes = 'approve' | 'burn' | 'mint' | 'transfer';

export const erc20Methods: Record<OpTypes, MethodSignature[]> = {
  approve: [
    {
      name: 'approveWithData',
      inputs: [
        { name: 'spender', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'data', type: 'bytes' },
      ],
      map: (dto: TokenApproval) => {
        // Not approved means 0 allowance; approved with no allowance means unlimited allowance
        const allowance = !dto.approved ? '0' : dto.config?.allowance ?? UINT256_MAX.toString();
        return [dto.operator, allowance, encodeHex(dto.data ?? '')];
      },
    },
    {
      name: 'approve',
      inputs: [
        { name: 'spender', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
      map: (dto: TokenApproval) => {
        // Not approved means 0 allowance; approved with no allowance means unlimited allowance
        const allowance = !dto.approved ? '0' : dto.config?.allowance ?? UINT256_MAX.toString();
        return [dto.operator, allowance];
      },
    },
  ],

  burn: [
    {
      name: 'burnWithData',
      inputs: [
        { name: 'from', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'data', type: 'bytes' },
      ],
      map: (dto: TokenBurn) => {
        return [dto.from, getAmountOrTokenID(dto, TokenType.FUNGIBLE), encodeHex(dto.data ?? '')];
      },
    },
    {
      name: 'burn',
      inputs: [
        { name: 'from', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
      map: (dto: TokenBurn) => {
        return [dto.from, getAmountOrTokenID(dto, TokenType.FUNGIBLE)];
      },
    },
  ],

  mint: [
    {
      name: 'mintWithData',
      inputs: [
        { name: 'to', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'data', type: 'bytes' },
      ],
      map: (dto: TokenMint) => {
        return [dto.to, getAmountOrTokenID(dto, TokenType.FUNGIBLE), encodeHex(dto.data ?? '')];
      },
    },
    {
      name: 'mint',
      inputs: [
        { name: 'to', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
      map: (dto: TokenMint) => {
        return [dto.to, getAmountOrTokenID(dto, TokenType.FUNGIBLE)];
      },
    },
  ],

  transfer: [
    {
      name: 'transferWithData',
      inputs: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'data', type: 'bytes' },
      ],
      map: (dto: TokenTransfer) => {
        return [
          dto.from,
          dto.to,
          getAmountOrTokenID(dto, TokenType.FUNGIBLE),
          encodeHex(dto.data ?? ''),
        ];
      },
    },
    {
      name: 'transferFrom',
      inputs: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
      map: (dto: TokenTransfer) => {
        return [dto.from, dto.to, getAmountOrTokenID(dto, TokenType.FUNGIBLE)];
      },
    },
  ],
};

export const erc721Methods: Record<OpTypes, MethodSignature[]> = {
  approve: [
    {
      name: 'approveWithData',
      inputs: [
        { name: 'to', type: 'address' },
        { name: 'tokenId', type: 'uint256' },
        { name: 'data', type: 'bytes' },
      ],
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
      inputs: [
        { name: 'operator', type: 'address' },
        { name: 'approved', type: 'bool' },
        { name: 'data', type: 'bytes' },
      ],
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
      inputs: [
        { name: 'to', type: 'address' },
        { name: 'tokenId', type: 'uint256' },
      ],
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
      inputs: [
        { name: 'operator', type: 'address' },
        { name: 'approved', type: 'bool' },
      ],
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
      inputs: [
        { name: 'from', type: 'address' },
        { name: 'tokenId', type: 'uint256' },
        { name: 'data', type: 'bytes' },
      ],
      map: (dto: TokenBurn) => {
        return [
          dto.from,
          getAmountOrTokenID(dto, TokenType.NONFUNGIBLE),
          encodeHex(dto.data ?? ''),
        ];
      },
    },
    {
      name: 'burn',
      inputs: [
        { name: 'from', type: 'address' },
        { name: 'tokenId', type: 'uint256' },
      ],
      map: (dto: TokenBurn) => {
        return [dto.from, getAmountOrTokenID(dto, TokenType.NONFUNGIBLE)];
      },
    },
  ],

  mint: [
    {
      name: 'mintWithURI',
      inputs: [
        { name: 'to', type: 'address' },
        { name: 'tokenId', type: 'uint256' },
        { name: 'data', type: 'bytes' },
        { name: 'tokenURI_', type: 'string' },
      ],
      map: (dto: TokenMint) => {
        return [
          dto.to,
          getAmountOrTokenID(dto, TokenType.NONFUNGIBLE),
          encodeHex(dto.data ?? ''),
          dto.uri,
        ];
      },
    },
    {
      name: 'mintWithData',
      inputs: [
        { name: 'to', type: 'address' },
        { name: 'tokenId', type: 'uint256' },
        { name: 'data', type: 'bytes' },
      ],
      map: (dto: TokenMint) => {
        return [dto.to, getAmountOrTokenID(dto, TokenType.NONFUNGIBLE), encodeHex(dto.data ?? '')];
      },
    },
    {
      name: 'mint',
      inputs: [
        { name: 'to', type: 'address' },
        { name: 'tokenId', type: 'uint256' },
      ],
      map: (dto: TokenMint) => {
        return [dto.to, getAmountOrTokenID(dto, TokenType.NONFUNGIBLE)];
      },
    },
  ],

  transfer: [
    {
      name: 'transferWithData',
      inputs: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'tokenId', type: 'uint256' },
        { name: 'data', type: 'bytes' },
      ],
      map: (dto: TokenTransfer) => {
        return [
          dto.from,
          dto.to,
          getAmountOrTokenID(dto, TokenType.NONFUNGIBLE),
          encodeHex(dto.data ?? ''),
        ];
      },
    },
    {
      name: 'safeTransferFrom',
      inputs: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'tokenId', type: 'uint256' },
      ],
      map: (dto: TokenTransfer) => {
        return [dto.from, dto.to, getAmountOrTokenID(dto, TokenType.NONFUNGIBLE)];
      },
    },
  ],
};
