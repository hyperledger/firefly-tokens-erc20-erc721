import { Controller, Get } from '@nestjs/common';
import { HealthCheckService, HealthCheck, HttpHealthIndicator } from '@nestjs/terminus';
import { BlockchainConnectorService } from '../tokens/blockchain.service';
import { getHttpRequestOptions } from '../utils';

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private http: HttpHealthIndicator,
    private blockchain: BlockchainConnectorService,
  ) {}

  @Get('/liveness')
  @HealthCheck()
  liveness() {
    return this.health.check([]);
  }

  @Get('/readiness')
  @HealthCheck()
  readiness() {
    return this.health.check([
      () =>
        this.http.pingCheck('ethconnect', `${this.blockchain.baseUrl}/status`, {
          auth: {
            username: this.blockchain.username,
            password: this.blockchain.password,
          },
        }),
    ]);
  }
}
