import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CategoryController } from './controllers/category.controller';
import { CategoryService } from './services/category.service';
import { CategoryEntity } from './repositories/entities/category.entity';
import { CategoryRepository } from './repositories/repository/category.repository';
import { SubCategoryModule } from '../sub-category/subCategory.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CategoryEntity]),
    forwardRef(() => SubCategoryModule), // Utilisez forwardRef ici aussi
  ],
  controllers: [CategoryController],
  providers: [
    CategoryService,
    CategoryRepository,
  ],
  exports: [
    CategoryService,
    TypeOrmModule,
  ],
})
export class CategoryModule {}