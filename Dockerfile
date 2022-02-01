FROM node:14-alpine3.11
RUN apk add curl
WORKDIR /root
ADD package*.json ./
RUN npm install
ADD . .
RUN npm run build

EXPOSE 3000
CMD ["npm", "run", "start:prod"]