import { Injectable } from "@nestjs/common";
import { HistoryRepository } from "./repository/HistoryRepository";

@Injectable()
export class YourService {
  constructor(
    private readonly historyRepository: HistoryRepository,
  ) {}
}