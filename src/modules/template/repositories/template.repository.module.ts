import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Template } from './entities/template.entity';
import {  } from '@nestjs-cls/transactional-adapter-typeorm';
import { TemplateRepository } from './repository/template.repositoty';

@Module({
  imports: [
    TypeOrmModule.forFeature([Template]),
  ],
  controllers: [],
  providers: [TemplateRepository],
  exports: [TemplateRepository],
})
export class TemplateRepositoryModule {}