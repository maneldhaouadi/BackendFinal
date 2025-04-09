import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CategoryModule } from '../category/category.module';
import { SubCategoryEntity } from './repositories/entities/subCategory.entity';
import { SubCategoryController } from './controllers/subCategory.controller';
import { SubCategoryService } from './services/subCategory.service';
import { SubCategoryRepository } from './repositories/repository/subCategory.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([SubCategoryEntity]),
    forwardRef(() => CategoryModule), // Utilisez forwardRef ici
  ],
  controllers: [SubCategoryController],
  providers: [
    SubCategoryService,
    SubCategoryRepository,
  ],
  exports: [
    SubCategoryService,
  ],
})
export class SubCategoryModule {}