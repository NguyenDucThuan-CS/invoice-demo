import { BadGatewayException, Body, Controller, Get, Headers, HttpException, Inject, Param, Post, Query } from "@nestjs/common";
import { MinutesService, SignatureRequest } from "./minutes.service";
import { WorkService } from "./work.service";

type StartBody = {
  processDefinitionId?: string;
  businessKey?: string;
  values?: Record<string, unknown>;
};

type CompleteBody = {
  values?: Record<string, unknown>;
};

@Controller("api")
export class WorkController {
  constructor(
    @Inject(WorkService) private readonly workService: WorkService,
    @Inject(MinutesService) private readonly minutesService: MinutesService,
  ) {}

  @Get("health")
  health() {
    return this.workService.health();
  }

  @Get("deployments")
  deployments() {
    return this.guard(() => this.workService.deployments());
  }

  @Get("work")
  work(
    @Query("deploymentId") deploymentId?: string,
    @Query("processDefinitionId") processDefinitionId?: string,
  ) {
    return this.guard(() =>
      this.workService.work({
        deploymentId: deploymentId || undefined,
        processDefinitionId: processDefinitionId || undefined,
      }),
    );
  }

  @Post("processes/start")
  start(@Body() body: StartBody) {
    return this.guard(() =>
      this.workService.start(body.processDefinitionId ?? "", body.businessKey, body.values ?? {}),
    );
  }

  @Post("tasks/:id/complete")
  complete(@Param("id") id: string, @Body() body: CompleteBody) {
    return this.guard(() => this.workService.complete(id, body.values ?? {}));
  }

  @Post("cases/:id/minutes")
  minutes(
    @Param("id") id: string,
    @Body() body: SignatureRequest,
    @Headers("x-documenso-token") token?: string,
  ) {
    return this.guard(() => this.minutesService.create(id, body ?? {}, token));
  }

  private async guard<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const message = error instanceof Error ? error.message : "Lỗi không xác định";
      throw new BadGatewayException(message);
    }
  }
}
