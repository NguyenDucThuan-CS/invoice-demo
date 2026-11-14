import { Module } from "@nestjs/common";
import { MinutesService } from "./minutes.service";
import { OperatonService } from "./operaton.service";
import { WorkController } from "./work.controller";
import { WorkService } from "./work.service";

@Module({
  controllers: [WorkController],
  providers: [WorkService, OperatonService, MinutesService],
})
export class AppModule {}
