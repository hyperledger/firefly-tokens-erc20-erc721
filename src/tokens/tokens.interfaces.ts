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
import { IsDefined, IsEnum, IsNotEmpty, IsOptional } from 'class-validator';

// Ethconnect interfaces
export interface EthConnectAsyncResponse {
  sent: boolean;
  id: string;
}

export interface EthConnectReturn {
  output: string;
}

// REST API requests and responses
export class AsyncResponse {
  @ApiProperty()
  id: string;
}

export enum ContractStandardEnum {
  ERC20WithData = 'ERC20WithData',
  ERC721WithData = 'ERC721WithData',
}

export enum ContractMethodEnum {
  ERC20WithDataMintWithData = 'mintWithData',
  ERC20WithDataTransferWithData = 'transferWithData',
  ERC20WithDataBurnWithData = 'burnWithData',
}

export enum EncodedPoolIdEnum {
  Address = 'address',
  Standard = 'standard',
  Type = 'type',
}

export interface IPoolId {
  address: string;
  standard: string;
  type: string;
}

export enum TokenType {
  FUNGIBLE = 'fungible',
  NONFUNGIBLE = 'nonfungible',
}

export interface ITokenPool {
  address: string;
  standard: string;
  type: TokenType;
}

const contractConfigDescription =
  'Optional configuration info for the token pool. Reserved for future use.';
const requestIdDescription =
  'Optional ID to identify this request. Must be unique for every request. ' +
  'If none is provided, one will be assigned and returned in the 202 response.';

export class TokenPool {
  @ApiProperty()
  @IsNotEmpty()
  name: string;

  @ApiProperty()
  @IsNotEmpty()
  signer: string;

  @ApiProperty()
  @IsNotEmpty()
  symbol: string;

  @ApiProperty({ enum: TokenType })
  @IsEnum(TokenType)
  type: TokenType;

  @ApiProperty({ description: contractConfigDescription })
  @IsDefined()
  config: {
    address: string;
  };

  @ApiProperty()
  @IsOptional()
  data?: string;

  @ApiProperty({ description: requestIdDescription })
  @IsOptional()
  requestId?: string;
}

export class BlockchainTransaction {
  @ApiProperty()
  @IsNotEmpty()
  blockNumber: string;

  @ApiProperty()
  @IsNotEmpty()
  logIndex: string;

  @ApiProperty()
  @IsNotEmpty()
  transactionHash: string;

  @ApiProperty()
  @IsNotEmpty()
  transactionIndex: string;

  @ApiProperty()
  @IsOptional()
  signature: string;

  @ApiProperty()
  @IsOptional()
  address: string;
}

export class TokenPoolActivate {
  @ApiProperty()
  @IsNotEmpty()
  poolId: string;

  @ApiProperty()
  @IsOptional()
  transaction?: BlockchainTransaction;

  @ApiProperty({ description: requestIdDescription })
  @IsOptional()
  requestId?: string;
}

export class TokenTransfer {
  @ApiProperty()
  @IsOptional()
  amount?: string;

  @ApiProperty()
  @IsOptional()
  tokenIndex?: string;

  @ApiProperty()
  @IsNotEmpty()
  from: string;

  @ApiProperty()
  @IsNotEmpty()
  signer: string;

  @ApiProperty()
  @IsNotEmpty()
  poolId: string;

  @ApiProperty()
  @IsNotEmpty()
  to: string;

  @ApiProperty()
  @IsOptional()
  data?: string;

  @ApiProperty({ description: requestIdDescription })
  @IsOptional()
  requestId?: string;
}

export class TokenMint extends OmitType(TokenTransfer, ['from']) {}
export class TokenBurn extends OmitType(TokenTransfer, ['to']) {}

// Websocket notifications

class tokenEventBase {
  @ApiProperty()
  data?: string;

  @ApiProperty()
  signer?: string;

  @ApiProperty()
  rawOutput?: any;

  @ApiProperty()
  poolId: string;

  @ApiProperty()
  timestamp: string;

  @ApiProperty()
  transaction?: BlockchainTransaction;

  @ApiProperty()
  type: TokenType;

  @ApiProperty()
  location?: string;

  @ApiProperty()
  signature?: string;
}

export class TokenPoolEventInfo {
  @ApiProperty()
  name: string;

  @ApiProperty()
  address: string;
}

export class TokenPoolEvent extends tokenEventBase {
  @ApiProperty()
  standard: string;

  @ApiProperty()
  symbol: string;

  @ApiProperty()
  info: TokenPoolEventInfo;
}

export class TokenTransferEvent extends tokenEventBase {
  @ApiProperty()
  id: string;

  @ApiProperty()
  tokenIndex?: string;

  @ApiProperty()
  from: string;

  @ApiProperty()
  to: string;

  @ApiProperty()
  amount: string;

  @ApiProperty()
  uri?: string;
}

export class TokenMintEvent extends OmitType(TokenTransferEvent, ['from']) {}
export class TokenBurnEvent extends OmitType(TokenTransferEvent, ['to']) {}

export interface TransactionDetails {
  blockHash: string;
  blockNumber: string;
  blockNumberHex: string;
  from: string;
  to: string;
  gas: string;
  gasHex: string;
  gasPrice: string;
  gasPriceHex: string;
  hash: string;
  nonce: string;
  nonceHex: string;
  transactionIndex: string;
  transactionIndexHex: string;
  value: string;
  valueHex: string;
  input: string;
  inputArgs: any;
}

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
