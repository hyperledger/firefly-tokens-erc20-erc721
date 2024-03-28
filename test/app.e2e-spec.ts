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

import { TestContext } from './app.e2e-context';
import SuiteErc20 from './suites/erc20';
import SuiteErc721 from './suites/erc721';
import SuiteWebsocket from './suites/websocket';

describe('AppController (e2e)', () => {
  const context = new TestContext();

  function addSuite(name: string, suite: (context: TestContext) => void) {
    describe(name, () => {
      beforeEach(() => context.begin());
      afterEach(() => context.end());
      suite(context);
    });
  }

  addSuite('ERC20 API', SuiteErc20);
  addSuite('ERC721 API', SuiteErc721);
  addSuite('Websocket Events', SuiteWebsocket);
});
