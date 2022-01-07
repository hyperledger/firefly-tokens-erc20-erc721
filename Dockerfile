FROM node:14-alpine3.11 AS solidity-builder
RUN apk add python make
WORKDIR /root
ADD solidity/package*.json ./
RUN npm install
RUN npm config set user 0
ADD solidity/ ./
RUN npx truffle compile

FROM node:14-alpine3.11
RUN apk add curl
WORKDIR /root
ADD package*.json ./
RUN npm install
ADD . .
RUN npm run build
COPY --from=solidity-builder /root/build/contracts contracts

EXPOSE 3000
CMD ["npm", "run", "start:prod"]
