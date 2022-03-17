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

import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { EventStreamReply } from '../event-stream/event-stream.interfaces';
import {
  AsyncResponse,
  TokenApproval,
  TokenBurn,
  TokenMint,
  TokenPool,
  TokenPoolActivate,
  TokenTransfer,
} from './tokens.interfaces';
import { TokensService } from './tokens.service';

@Controller()
export class TokensController {
  constructor(private readonly service: TokensService) {}

  @Post('init')
  @HttpCode(204)
  @ApiOperation({ summary: 'Perform one-time initialization (if not auto-initialized)' })
  init() {
    return this.service.init();
  }

  @Post('createpool')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Register a new ERC20 or ERC721 contract',
    description: 'The contract must be deployed on-chain before calling this method',
  })
  @ApiBody({ type: TokenPool })
  @ApiResponse({ status: 202, type: AsyncResponse })
  createPool(@Body() dto: TokenPool) {
    return this.service.createPool(dto);
  }

  @Post('activatepool')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Activate a token pool to begin receiving transfer events',
  })
  @ApiBody({ type: TokenPoolActivate })
  activatePool(@Body() dto: TokenPoolActivate) {
    return this.service.activatePool(dto);
  }

  @Post('mint')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Mint new tokens',
    description:
      'Will be followed by a websocket notification with event=token-mint and data=TokenMintEvent',
  })
  @ApiBody({ type: TokenMint })
  @ApiResponse({ status: 202, type: AsyncResponse })
  mint(@Body() dto: TokenMint) {
    return this.service.mint(dto);
  }

  @Post('transfer')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Transfer tokens',
    description:
      'Will be followed by a websocket notification with event=token-transfer and data=TokenTransferEvent',
  })
  @ApiBody({ type: TokenTransfer })
  @ApiResponse({ status: 202, type: AsyncResponse })
  transfer(@Body() dto: TokenTransfer) {
    return this.service.transfer(dto);
  }

  @Post('approval')
  @HttpCode(202)
  @ApiOperation({
    summary: "Approves a spender to perform token transfers on the caller's behalf",
    description: 'Will be followed by a websocket notification with event=token-approval',
  })
  @ApiBody({ type: TokenApproval })
  @ApiResponse({ status: 202, type: AsyncResponse })
  approve(@Body() dto: TokenApproval) {
    return this.service.approval(dto);
  }

  @Post('burn')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Burn tokens',
    description:
      'Will be followed by a websocket notification with event=token-burn and data=TokenBurnEvent',
  })
  @ApiBody({ type: TokenBurn })
  @ApiResponse({ status: 202, type: AsyncResponse })
  burn(@Body() dto: TokenBurn) {
    return this.service.burn(dto);
  }

  @Get('receipt/:id')
  @ApiOperation({ summary: 'Retrieve the result of an async operation' })
  @ApiResponse({ status: 200, type: EventStreamReply })
  getReceipt(@Param('id') id: string) {
    return this.service.getReceipt(id);
  }
}
