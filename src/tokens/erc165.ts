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
