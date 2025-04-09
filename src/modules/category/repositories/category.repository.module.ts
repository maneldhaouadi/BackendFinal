import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CategoryEntity } from './entities/category.entity';
import { CategoryRepository } from './repository/category.repository';

@Module({
  controllers: [],
  providers: [CategoryRepository],
  exports: [CategoryRepository],
  imports: [TypeOrmModule.forFeature([CategoryEntity])],
})
export class CategoryRepositoryModule {}