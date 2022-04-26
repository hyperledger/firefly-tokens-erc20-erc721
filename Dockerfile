FROM node:16-alpine3.15 as build
USER node
WORKDIR /home/node
ADD --chown=node:node package*.json ./
RUN npm install
ADD --chown=node:node . .
RUN npm run build

FROM node:16-alpine3.15 as solidity-build
RUN apk add python3 alpine-sdk
USER node
WORKDIR /home/node
ADD --chown=node:node ./samples/solidity/package*.json ./
RUN npm install
ADD --chown=node:node ./samples/solidity .
RUN npx hardhat compile

FROM node:16-alpine3.15
RUN apk add curl jq
USER node
WORKDIR /home/node/contracts/source
COPY --from=solidity-build /home/node/contracts /home/node/package*.json ./
RUN npm install --production
WORKDIR /home/node/contracts
COPY --from=solidity-build /home/node/artifacts/contracts/TokenFactory.sol/TokenFactory.json ./
WORKDIR /home/node
COPY --from=build /home/node/dist ./dist
COPY --from=build /home/node/package.json /home/node/package-lock.json ./


RUN npm install --production
EXPOSE 3000
CMD ["npm", "run", "start:prod"]