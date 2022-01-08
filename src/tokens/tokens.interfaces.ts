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
import { IsNotEmpty, IsOptional } from 'class-validator';
import { Event } from '../event-stream/event-stream.interfaces';

// Ethconnect interfaces
export interface EthConnectAsyncResponse {
  sent: boolean;
  id: string;
}

export interface EthConnectReturn {
  output: string;
}

export interface TokenCreateEvent extends Event {
  data: {
    operator: string;
    type_id: string;
    data: string;
  };
}

export interface TransferSingleEvent extends Event {
  data: {
    from: string;
    to: string;
    operator: string;
    id: string;
    value: string;
  };
}

export interface TransferBatchEvent extends Event {
  data: {
    from: string;
    to: string;
    operator: string;
    ids: string[];
    values: string[];
  };
}

// REST API requests and responses
export class AsyncResponse {
  @ApiProperty()
  id: string;
}

const requestIdDescription =
  'Optional ID to identify this request. Must be unique for every request. ' +
  'If none is provided, one will be assigned and returned in the 202 response.';
const poolConfigDescription =
  'Optional configuration info for the token pool. Reserved for future use.';

export class TokenPool {
  @ApiProperty()
  @IsNotEmpty()
  operator: string;

  @ApiProperty({ description: requestIdDescription })
  @IsOptional()
  requestId?: string;

  @ApiProperty()
  @IsOptional()
  data?: string;

  @ApiProperty({ description: poolConfigDescription })
  @IsOptional()
  config?: any;
}

export class BlockchainTransaction {
  @ApiProperty()
  @IsNotEmpty()
  blockNumber: string;

  @ApiProperty()
  @IsNotEmpty()
  transactionIndex: string;

  @ApiProperty()
  @IsNotEmpty()
  transactionHash: string;

  @ApiProperty()
  @IsOptional() // only optional to support activating very old pools - TODO: remove eventually
  logIndex: string;
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

export class TokenBalanceQuery {
  @ApiProperty()
  @IsNotEmpty()
  poolId: string;

  @ApiProperty()
  @IsNotEmpty()
  tokenIndex: string;

  @ApiProperty()
  @IsNotEmpty()
  account: string;
}

export class TokenBalance {
  @ApiProperty()
  balance: string;
}

export class TokenTransfer {
  @ApiProperty()
  @IsNotEmpty()
  poolId: string;

  @ApiProperty()
  @IsOptional()
  tokenIndex?: string;

  @ApiProperty()
  @IsNotEmpty()
  operator: string;

  @ApiProperty()
  @IsNotEmpty()
  from: string;

  @ApiProperty()
  @IsNotEmpty()
  to: string;

  @ApiProperty()
  @IsNotEmpty()
  amount: string;

  @ApiProperty({ description: requestIdDescription })
  @IsOptional()
  requestId?: string;

  @ApiProperty()
  @IsOptional()
  data?: string;
}

export class TokenMint extends OmitType(TokenTransfer, ['tokenIndex', 'from']) {}
export class TokenBurn extends OmitType(TokenTransfer, ['to']) {}

// Websocket notifications

class tokenEventBase {
  @ApiProperty()
  poolId: string;

  @ApiProperty()
  operator: string;

  @ApiProperty()
  data?: string;

  @ApiProperty()
  transaction: BlockchainTransaction;
}

export class TokenPoolEvent extends tokenEventBase {
  @ApiProperty()
  standard: string;
}

export class TokenTransferEvent extends tokenEventBase {
  @ApiProperty()
  id: string;

  @ApiProperty()
  tokenIndex?: string;

  @ApiProperty()
  uri: string;

  @ApiProperty()
  from: string;

  @ApiProperty()
  to: string;

  @ApiProperty()
  amount: string;
}

export class TokenMintEvent extends OmitType(TokenTransferEvent, ['from']) {}
export class TokenBurnEvent extends OmitType(TokenTransferEvent, ['to']) {}
