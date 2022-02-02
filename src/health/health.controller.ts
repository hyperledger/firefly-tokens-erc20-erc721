import { Controller, Get } from '@nestjs/common';
import { HealthCheckService, HealthCheck, HttpHealthIndicator } from '@nestjs/terminus';
import { TokensService } from '../tokens/tokens.service';
import { basicAuth } from '../utils';

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private http: HttpHealthIndicator,
    private readonly tokensService: TokensService,
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
        this.http.pingCheck(
          'ethconnect-contract',
          this.tokensService.baseUrl,
          basicAuth(this.tokensService.username, this.tokensService.password),
        ),
    ]);
  }
}
