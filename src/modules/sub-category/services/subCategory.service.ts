import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CategoryService } from 'src/modules/category/services/category.service';
import { Repository } from 'typeorm';
import { SubCategoryEntity } from '../repositories/entities/subCategory.entity';
import { CreateSubCategoryDto } from '../dtos/subCategory.create.dto';
import { UpdateSubCategoryDto } from '../dtos/subCategory.update.dto';


@Injectable()
export class SubCategoryService {
  constructor(
    @InjectRepository(SubCategoryEntity)
    private readonly subCategoryRepository: Repository<SubCategoryEntity>,
    private readonly categoryService: CategoryService,
  ) {}

  async findAll(): Promise<SubCategoryEntity[]> {
    return this.subCategoryRepository.find({ relations: ['category'] });
  }

  async findOne(id: number): Promise<SubCategoryEntity> {
    const subCategory = await this.subCategoryRepository.findOne({ 
      where: { id },
      relations: ['category'] 
    });
    if (!subCategory) {
      throw new NotFoundException(`SubCategory with ID ${id} not found`);
    }
    return subCategory;
  }

  async create(createSubCategoryDto: CreateSubCategoryDto): Promise<SubCategoryEntity> {
    const category = await this.categoryService.findOne(createSubCategoryDto.categoryId);
    const subCategory = this.subCategoryRepository.create({
      ...createSubCategoryDto,
      category,
    });
    return this.subCategoryRepository.save(subCategory);
  }

  async update(id: number, updateSubCategoryDto: UpdateSubCategoryDto): Promise<SubCategoryEntity> {
    const subCategory = await this.findOne(id);
    
    if (updateSubCategoryDto.categoryId) {
      const category = await this.categoryService.findOne(updateSubCategoryDto.categoryId);
      subCategory.category = category;
    }

    this.subCategoryRepository.merge(subCategory, updateSubCategoryDto);
    return this.subCategoryRepository.save(subCategory);
  }

  async delete(id: number): Promise<void> {
    const subCategory = await this.findOne(id);
    await this.subCategoryRepository.remove(subCategory);
  }

  async softDelete(id: number): Promise<void> {
    await this.subCategoryRepository.softDelete(id);
  }

  async restore(id: number): Promise<void> {
    await this.subCategoryRepository.restore(id);
  }

  async findByNameAndCategory(name: string, categoryId: number): Promise<SubCategoryEntity | null> {
    return this.subCategoryRepository.findOne({
      where: { 
        name,
        category: { id: categoryId } 
      },
      relations: ['category']
    });
  }
}