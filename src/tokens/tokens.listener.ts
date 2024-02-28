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

import { Logger } from '@nestjs/common';
import { Event } from '../event-stream/event-stream.interfaces';
import { EventListener } from '../eventstream-proxy/eventstream-proxy.interfaces';
import { WebSocketMessage } from '../websocket-events/websocket-events.base';
import { Context, newContext } from '../request-context/request-context.decorator';
import {
  ERC20ApprovalEvent,
  ERC721ApprovalEvent,
  ApprovalForAllEvent,
  IValidPoolLocator,
  TokenApprovalEvent,
  TokenBurnEvent,
  TokenPoolCreationEvent,
  TokenMintEvent,
  TokenPoolEvent,
  TokenTransferEvent,
  TokenType,
  TransferEvent,
  InterfaceFormat,
} from './tokens.interfaces';
import {
  decodeHex,
  packPoolLocator,
  unpackPoolLocator,
  unpackSubscriptionName,
  validatePoolLocator,
} from './tokens.util';
import { AbiMapperService } from './abimapper.service';
import { BlockchainConnectorService } from './blockchain.service';
import { TokenURI as ERC721URI } from './erc721';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const tokenCreateEventSignature = 'TokenPoolCreation(address,string,string,bool,bytes)';
const transferEventSignature = 'Transfer(address,address,uint256)';
const approvalEventSignature = 'Approval(address,address,uint256)';
const approvalForAllEventSignature = 'ApprovalForAll(address,address,bool)';

export class TokenListener implements EventListener {
  private readonly logger = new Logger(TokenListener.name);

  constructor(
    private mapper: AbiMapperService,
    private blockchain: BlockchainConnectorService,
  ) {}

  async onEvent(subName: string, event: Event) {
    const signature = this.trimEventSignature(event.signature);
    switch (signature) {
      case tokenCreateEventSignature:
        return this.transformTokenPoolCreationEvent(subName, event);
      case transferEventSignature:
        return this.transformTransferEvent(subName, event);
      case approvalEventSignature:
        return this.transformApprovalEvent(subName, event);
      case approvalForAllEventSignature:
        return this.transformApprovalForAllEvent(subName, event);
      default:
        this.logger.error(`Unknown event signature: ${event.signature}`);
    }
  }

  private async getTokenUri(
    ctx: Context,
    tokenIdx: string,
    contractAddress: string,
  ): Promise<string> {
    try {
      const response = await this.blockchain.query(ctx, contractAddress, ERC721URI, [tokenIdx]);
      return response.output as string;
    } catch (e) {
      this.logger.log(`Could not query token URI: ${e}`);
      return '';
    }
  }

  /**
   * Generate an event ID in the recognized FireFly format for Ethereum
   * (zero-padded block number, transaction index, and log index)
   */
  private formatBlockchainEventId(event: Event) {
    const blockNumber = event.blockNumber ?? '0';
    const txIndex = BigInt(event.transactionIndex).toString(10);
    const logIndex = event.logIndex ?? '0';
    return [
      blockNumber.padStart(12, '0'),
      txIndex.padStart(6, '0'),
      logIndex.padStart(6, '0'),
    ].join('/');
  }

  private stripParamsFromSignature(signature: string) {
    return signature.substring(0, signature.indexOf('('));
  }

  private trimEventSignature(signature: string) {
    const firstColon = signature.indexOf(':');
    if (firstColon > 0) {
      return signature.substring(firstColon + 1);
    }
    return signature;
  }

  private async transformTokenPoolCreationEvent(
    subName: string,
    event: TokenPoolCreationEvent,
  ): Promise<WebSocketMessage | undefined> {
    const ctx = newContext();
    const { data: output } = event;
    const unpackedSub = unpackSubscriptionName(subName);
    const decodedData = decodeHex(output.data ?? '');

    const type = output.is_fungible ? TokenType.FUNGIBLE : TokenType.NONFUNGIBLE;
    const decimals = output.is_fungible
      ? await this.mapper.getDecimals(ctx, output.contract_address)
      : 0;
    const schema = await this.mapper.getTokenSchema(ctx, type, output.contract_address);
    const poolLocator: IValidPoolLocator = {
      address: output.contract_address.toLowerCase(),
      type,
      schema,
    };

    return {
      event: 'token-pool',
      data: <TokenPoolEvent>{
        standard: type === TokenType.FUNGIBLE ? 'ERC20' : 'ERC721',
        interfaceFormat: InterfaceFormat.ABI,
        poolData: unpackedSub.poolData,
        poolLocator: packPoolLocator(poolLocator),
        type,
        signer: event.inputSigner,
        data: decodedData,
        symbol: output.symbol,
        decimals,
        info: {
          name: output.name,
          address: output.contract_address,
          schema,
        },
        blockchain: {
          id: this.formatBlockchainEventId(event),
          name: this.stripParamsFromSignature(this.trimEventSignature(event.signature)),
          location: 'address=' + event.address,
          signature: this.trimEventSignature(event.signature),
          timestamp: event.timestamp,
          output,
          info: {
            blockNumber: event.blockNumber,
            transactionIndex: event.transactionIndex,
            transactionHash: event.transactionHash,
            logIndex: event.logIndex,
            address: event.address,
            signature: this.trimEventSignature(event.signature),
          },
        },
      },
    };
  }

  private async transformTransferEvent(
    subName: string,
    event: TransferEvent,
  ): Promise<WebSocketMessage | undefined> {
    const { data: output } = event;
    const unpackedSub = unpackSubscriptionName(subName);
    const decodedData = decodeHex(event.inputArgs?.data ?? '');

    if (output.from === ZERO_ADDRESS && output.to === ZERO_ADDRESS) {
      // should not happen
      return undefined;
    }
    if (unpackedSub.poolLocator === undefined) {
      // should not happen
      return undefined;
    }

    const eventId = this.formatBlockchainEventId(event);
    const poolLocator = unpackPoolLocator(unpackedSub.poolLocator);
    const commonData = {
      id: eventId,
      poolData: unpackedSub.poolData,
      poolLocator: unpackedSub.poolLocator,
      amount: poolLocator.type === TokenType.FUNGIBLE ? output.value : '1',
      signer: event.inputSigner,
      data: decodedData,
      blockchain: {
        id: eventId,
        name: this.stripParamsFromSignature(this.trimEventSignature(event.signature)),
        location: 'address=' + event.address,
        signature: this.trimEventSignature(event.signature),
        timestamp: event.timestamp,
        output,
        info: {
          address: event.address,
          blockNumber: event.blockNumber,
          transactionIndex: event.transactionIndex,
          transactionHash: event.transactionHash,
          logIndex: event.logIndex,
          signature: this.trimEventSignature(event.signature),
        },
      },
    } as TokenTransferEvent;

    if (poolLocator.type === TokenType.NONFUNGIBLE && output.tokenId !== undefined) {
      commonData.tokenIndex = output.tokenId;

      if (validatePoolLocator(poolLocator)) {
        commonData.uri = await this.getTokenUri(
          newContext(),
          output.tokenId,
          poolLocator.address ?? '',
        );
      }
    }

    if (output.from === ZERO_ADDRESS) {
      return {
        event: 'token-mint',
        data: { ...commonData, to: output.to } as TokenMintEvent,
      };
    } else if (output.to === ZERO_ADDRESS) {
      return {
        event: 'token-burn',
        data: { ...commonData, from: output.from } as TokenBurnEvent,
      };
    } else {
      return {
        event: 'token-transfer',
        data: { ...commonData, from: output.from, to: output.to } as TokenTransferEvent,
      };
    }
  }

  private transformApprovalEvent(
    subName: string,
    event: ERC20ApprovalEvent | ERC721ApprovalEvent,
  ): WebSocketMessage | undefined {
    const { data: output } = event;
    const unpackedSub = unpackSubscriptionName(subName);
    const decodedData = decodeHex(event.inputArgs?.data ?? '');

    if (unpackedSub.poolLocator === undefined) {
      // should not happen
      return undefined;
    }
    const poolLocator = unpackPoolLocator(unpackedSub.poolLocator);

    let operator: string;
    let subject: string | undefined;
    let approved = true;
    if (poolLocator.type === TokenType.FUNGIBLE) {
      const erc20Event = event as ERC20ApprovalEvent;
      operator = erc20Event.data.spender;
      subject = `${output.owner}:${operator}`;
      approved = BigInt(erc20Event.data.value ?? 0) > BigInt(0);
    } else {
      const erc721Event = event as ERC721ApprovalEvent;
      operator = erc721Event.data.approved;
      subject = erc721Event.data.tokenId;
      approved = operator !== ZERO_ADDRESS;
    }

    const eventId = this.formatBlockchainEventId(event);
    return {
      event: 'token-approval',
      data: <TokenApprovalEvent>{
        id: eventId,
        poolData: unpackedSub.poolData,
        subject,
        poolLocator: unpackedSub.poolLocator,
        operator,
        approved,
        signer: output.owner,
        data: decodedData,
        info: output,
        blockchain: {
          id: eventId,
          name: this.stripParamsFromSignature(this.trimEventSignature(event.signature)),
          location: 'address=' + event.address,
          signature: this.trimEventSignature(event.signature),
          timestamp: event.timestamp,
          output,
          info: {
            blockNumber: event.blockNumber,
            transactionIndex: event.transactionIndex,
            transactionHash: event.transactionHash,
            logIndex: event.logIndex,
            address: event.address,
            signature: this.trimEventSignature(event.signature),
          },
        },
      },
    };
  }

  private transformApprovalForAllEvent(
    subName: string,
    event: ApprovalForAllEvent,
  ): WebSocketMessage | undefined {
    const { data: output } = event;
    const unpackedSub = unpackSubscriptionName(subName);
    const decodedData = decodeHex(event.inputArgs?.data ?? '');

    if (unpackedSub.poolLocator === undefined) {
      // should not happen
      return undefined;
    }

    const eventId = this.formatBlockchainEventId(event);
    return {
      event: 'token-approval',
      data: <TokenApprovalEvent>{
        id: eventId,
        poolData: unpackedSub.poolData,
        subject: `${output.owner}:${output.operator}`,
        poolLocator: unpackedSub.poolLocator,
        operator: output.operator,
        approved: output.approved,
        signer: output.owner,
        data: decodedData,
        info: output,
        blockchain: {
          id: eventId,
          name: this.stripParamsFromSignature(event.signature),
          location: 'address=' + event.address,
          signature: this.trimEventSignature(event.signature),
          timestamp: event.timestamp,
          output,
          info: {
            blockNumber: event.blockNumber,
            transactionIndex: event.transactionIndex,
            transactionHash: event.transactionHash,
            logIndex: event.logIndex,
            address: event.address,
            signature: this.trimEventSignature(event.signature),
          },
        },
      },
    };
  }
}
