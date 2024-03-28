// Copyright © 2024 Kaleido, Inc.
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

import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Res } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { Context, RequestContext } from '../request-context/request-context.decorator';
import { EventStreamReply } from '../event-stream/event-stream.interfaces';
import { BlockchainConnectorService } from './blockchain.service';
import {
  AsyncResponse,
  CheckInterfaceRequest,
  TokenApproval,
  TokenBurn,
  TokenMint,
  TokenPool,
  TokenPoolActivate,
  TokenPoolDeactivate,
  TokenPoolEvent,
  TokenTransfer,
} from './tokens.interfaces';
import { TokensService } from './tokens.service';

@Controller()
export class TokensController {
  constructor(
    private service: TokensService,
    private blockchain: BlockchainConnectorService,
  ) {}

  @Post('init')
  @HttpCode(204)
  @ApiOperation({ summary: 'Perform one-time initialization (if not auto-initialized)' })
  init(@RequestContext() ctx: Context) {
    // Do nothing. Endpoint retained for backwards compatibility with older tooling.
  }

  @Post('createpool')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Register a new ERC20 or ERC721 contract',
    description: 'The contract must be deployed on-chain before calling this method',
  })
  @ApiBody({ type: TokenPool })
  @ApiResponse({ status: 200, type: TokenPoolEvent })
  @ApiResponse({ status: 202, type: AsyncResponse })
  async createPool(
    @RequestContext() ctx: Context,
    @Body() dto: TokenPool,
    @Res({ passthrough: true }) res: Response,
  ) {
    const pool = await this.service.createPool(ctx, dto);
    if ('poolLocator' in pool) {
      res.status(HttpStatus.OK);
    } else {
      res.status(HttpStatus.ACCEPTED);
    }
    return pool;
  }

  @Post('activatepool')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Activate a token pool to begin receiving transfer and approval events',
  })
  @ApiBody({ type: TokenPoolActivate })
  activatePool(@RequestContext() ctx: Context, @Body() dto: TokenPoolActivate) {
    return this.service.activatePool(ctx, dto);
  }

  @Post('deactivatepool')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Deactivate a token pool to delete all listeners and stop receiving events',
  })
  @ApiBody({ type: TokenPoolDeactivate })
  async deactivatePool(@RequestContext() ctx: Context, @Body() dto: TokenPoolDeactivate) {
    await this.service.deactivatePool(ctx, dto);
  }

  @Post('checkinterface')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Check which interface methods are supported by this connector',
  })
  @ApiBody({ type: CheckInterfaceRequest })
  checkInterface(@Body() dto: CheckInterfaceRequest) {
    return this.service.checkInterface(dto);
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
  mint(@RequestContext() ctx: Context, @Body() dto: TokenMint) {
    return this.service.mint(ctx, dto);
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
  transfer(@RequestContext() ctx: Context, @Body() dto: TokenTransfer) {
    return this.service.transfer(ctx, dto);
  }

  @Post('approval')
  @HttpCode(202)
  @ApiOperation({
    summary: "Approves a spender to perform token transfers on the caller's behalf",
    description: 'Will be followed by a websocket notification with event=token-approval',
  })
  @ApiBody({ type: TokenApproval })
  @ApiResponse({ status: 202, type: AsyncResponse })
  approve(@RequestContext() ctx: Context, @Body() dto: TokenApproval) {
    return this.service.approval(ctx, dto);
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
  burn(@RequestContext() ctx: Context, @Body() dto: TokenBurn) {
    return this.service.burn(ctx, dto);
  }

  @Get('receipt/:id')
  @ApiOperation({ summary: 'Retrieve the result of an async operation' })
  @ApiResponse({ status: 200, type: EventStreamReply })
  getReceipt(@RequestContext() ctx: Context, @Param('id') id: string) {
    return this.blockchain.getReceipt(ctx, id);
  }
}
