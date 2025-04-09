import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubCategoryRepository } from './repository/subCategory.repository';
import { SubCategoryEntity } from './entities/subCategory.entity';


@Module({
  controllers: [],
  providers: [SubCategoryRepository],
  exports: [SubCategoryRepository],
  imports: [TypeOrmModule.forFeature([SubCategoryEntity])],
})
export class SubCategoryRepositoryModule {}