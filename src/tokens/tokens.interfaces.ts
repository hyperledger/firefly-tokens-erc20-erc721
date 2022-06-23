// Copyright © 2022 Kaleido, Inc.
//
// SPDX-License-Identifier: Apache-2.0
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { ApiProperty, OmitType } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional } from 'class-validator';
import { Event } from '../event-stream/event-stream.interfaces';

// Ethconnect interfaces
export interface EthConnectAsyncResponse {
  sent: boolean;
  id: string;
}

export interface EthConnectReturn {
  output: any;
}

export interface TokenPoolCreationEvent extends Event {
  data: {
    contract_address: string;
    name: string;
    symbol: string;
    is_fungible: boolean;
    data: string;
  };
}

export interface ERC20ApprovalEvent extends Event {
  data: {
    owner: string;
    spender: string;
    value: string;
  };
}

export interface ERC721ApprovalEvent extends Event {
  data: {
    owner: string;
    approved: string;
    tokenId: string;
  };
}

export interface ApprovalForAllEvent extends Event {
  data: {
    owner: string;
    operator: string;
    approved: boolean;
  };
}

export interface TransferEvent extends Event {
  data: {
    from: string;
    to: string;
    value?: string;
    tokenId?: string;
  };
}

// REST API requests and responses
export class AsyncResponse {
  @ApiProperty()
  id: string;
}

export enum ContractSchema {
  ERC20WithData = 'ERC20WithData',
  ERC20NoData = 'ERC20NoData',
  ERC721WithData = 'ERC721WithData',
  ERC721NoData = 'ERC721NoData',
}

export enum ContractMethod {
  ERC20WithDataMintWithData = 'mintWithData',
  ERC20WithDataTransferWithData = 'transferWithData',
  ERC20WithDataBurnWithData = 'burnWithData',
}

export enum EncodedPoolLocatorEnum {
  Address = 'address',
  Standard = 'standard', // deprecated in favor of "schema" below
  Schema = 'schema',
  Type = 'type',
}

export enum TokenType {
  FUNGIBLE = 'fungible',
  NONFUNGIBLE = 'nonfungible',
}

export interface IPoolLocator {
  address: string | null;
  schema: string | null;
  type: TokenType | null;
}

export interface IValidPoolLocator {
  address: string;
  schema: string;
  type: TokenType;
}

const requestIdDescription =
  'Optional ID to identify this request. Must be unique for every request. ' +
  'If none is provided, one will be assigned and returned in the 202 response.';

export class TokenPoolConfig {
  @ApiProperty()
  @IsOptional()
  address?: string;

  @ApiProperty()
  @IsOptional()
  blockNumber?: string;
}

export class TokenPool {
  @ApiProperty({ enum: TokenType })
  @IsEnum(TokenType)
  type: TokenType;

  @ApiProperty()
  @IsNotEmpty()
  signer: string;

  @ApiProperty()
  @IsNotEmpty()
  name: string;

  @ApiProperty()
  @IsOptional()
  symbol?: string;

  @ApiProperty({ description: requestIdDescription })
  @IsOptional()
  requestId?: string;

  @ApiProperty()
  @IsOptional()
  data?: string;

  @ApiProperty()
  @IsOptional()
  config?: TokenPoolConfig;

  @ApiProperty()
  @IsOptional()
  uri?: string;
}

export class TokenApprovalConfig {
  @ApiProperty()
  @IsOptional()
  allowance?: string;

  @ApiProperty()
  @IsOptional()
  tokenIndex?: string;
}

export class TokenApproval {
  @ApiProperty()
  @IsNotEmpty()
  poolLocator: string;

  @ApiProperty()
  @IsNotEmpty()
  signer: string;

  @ApiProperty()
  @IsNotEmpty()
  operator: string;

  @ApiProperty()
  @IsNotEmpty()
  approved: boolean;

  @ApiProperty({ description: requestIdDescription })
  @IsOptional()
  requestId?: string;

  @ApiProperty()
  @IsOptional()
  data?: string;

  @ApiProperty()
  @IsOptional()
  config?: TokenApprovalConfig;
}

export class BlockchainInfo {
  @ApiProperty()
  @IsNotEmpty()
  blockNumber: string;

  @ApiProperty()
  transactionIndex: string;

  @ApiProperty()
  transactionHash: string;

  @ApiProperty()
  logIndex: string;

  @ApiProperty()
  signature: string;

  @ApiProperty()
  address: string;
}

export class BlockchainEvent {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  output: any;

  @ApiProperty()
  info: BlockchainInfo;

  @ApiProperty()
  location: string;

  @ApiProperty()
  signature: string;

  @ApiProperty()
  timestamp: string;
}

export class TokenPoolActivate {
  @ApiProperty()
  @IsNotEmpty()
  poolLocator: string;

  @ApiProperty()
  @IsOptional()
  config?: TokenPoolConfig;

  @ApiProperty({ description: requestIdDescription })
  @IsOptional()
  requestId?: string;
}

export class TokenTransfer {
  @ApiProperty()
  @IsNotEmpty()
  poolLocator: string;

  @ApiProperty()
  @IsOptional()
  tokenIndex?: string;

  @ApiProperty()
  @IsNotEmpty()
  signer: string;

  @ApiProperty()
  @IsNotEmpty()
  from: string;

  @ApiProperty()
  @IsNotEmpty()
  to: string;

  @ApiProperty()
  @IsOptional()
  amount?: string;

  @ApiProperty()
  @IsOptional()
  uri?: string;

  @ApiProperty({ description: requestIdDescription })
  @IsOptional()
  requestId?: string;

  @ApiProperty()
  @IsOptional()
  data?: string;
}

export class TokenMint extends OmitType(TokenTransfer, ['from']) {}
export class TokenBurn extends OmitType(TokenTransfer, ['to']) {}

// Websocket notifications

class tokenEventBase {
  @ApiProperty()
  poolLocator: string;

  @ApiProperty()
  signer?: string;

  @ApiProperty()
  data?: string;

  @ApiProperty()
  blockchain?: BlockchainEvent;
}

export class TokenPoolEventInfo {
  @ApiProperty()
  name: string;

  @ApiProperty()
  address: string;

  @ApiProperty()
  schema: string;
}

export class TokenPoolEvent extends tokenEventBase {
  @ApiProperty()
  type: TokenType;

  @ApiProperty()
  standard: string;

  @ApiProperty()
  symbol: string;

  @ApiProperty({ type: 'integer' })
  decimals: number;

  @ApiProperty()
  info: TokenPoolEventInfo;
}

export class TokenTransferEvent extends tokenEventBase {
  @ApiProperty()
  id: string;

  @ApiProperty()
  tokenIndex?: string;

  @ApiProperty()
  uri?: string;

  @ApiProperty()
  from: string;

  @ApiProperty()
  to: string;

  @ApiProperty()
  amount: string;
}

export class TokenMintEvent extends OmitType(TokenTransferEvent, ['from']) {}
export class TokenBurnEvent extends OmitType(TokenTransferEvent, ['to']) {}

export class TokenApprovalEvent extends tokenEventBase {
  @ApiProperty()
  id: string;

  @ApiProperty()
  subject: string;

  @ApiProperty()
  operator: string;

  @ApiProperty()
  approved: boolean;

  @ApiProperty()
  info: any;
}

// ABI format

export interface IAbiInput {
  indexed?: boolean;
  internalType: string;
  name: string;
  type: string;
}

export interface IAbiMethod {
  anonymous?: boolean;
  inputs?: IAbiInput[];
  outputs?: any[];
  stateMutability?: string;
  name?: string;
  type?: string;
}

export interface EthConnectMsgRequest {
  headers: {
    type: string;
  };
  from?: string;
  to: string;
  method: IAbiMethod;
  params: any[];
}
