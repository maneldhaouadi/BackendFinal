import { EntityRepository, Repository } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { SubCategoryEntity } from '../entities/subCategory.entity';

@EntityRepository(SubCategoryEntity)
export class SubCategoryRepository extends Repository<SubCategoryEntity> {
  async findById(id: number, withCategory = false): Promise<SubCategoryEntity> {
    const relations = [];
    if (withCategory) {
      relations.push('category');
    }

    const subCategory = await this.findOne({
      where: { id },
      relations,
    });

    if (!subCategory) {
      throw new NotFoundException(`SubCategory with ID ${id} not found`);
    }

    return subCategory;
  }

  async findByCategoryId(categoryId: number): Promise<SubCategoryEntity[]> {
    return this.find({
      where: { category: { id: categoryId } },
      relations: ['category'],
      order: {
        name: 'ASC',
      },
    });
  }

  async findByNameAndCategory(name: string, categoryId: number): Promise<SubCategoryEntity | undefined> {
    return this.findOne({
      where: { name, category: { id: categoryId } },
    });
  }

  async createSubCategory(createData: Partial<SubCategoryEntity>): Promise<SubCategoryEntity> {
    const subCategory = this.create(createData);
    return this.save(subCategory);
  }

  async updateSubCategory(id: number, updateData: Partial<SubCategoryEntity>): Promise<SubCategoryEntity> {
    const subCategory = await this.findById(id);
    this.merge(subCategory, updateData);
    return this.save(subCategory);
  }

  async deleteSubCategory(id: number): Promise<void> {
    const result = await this.softDelete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`SubCategory with ID ${id} not found`);
    }
  }

  async restoreSubCategory(id: number): Promise<void> {
    const result = await this.restore(id);
    if (result.affected === 0) {
      throw new NotFoundException(`SubCategory with ID ${id} not found or not deleted`);
    }
  }

  async countArticlesInSubCategory(subCategoryId: number): Promise<number> {
    // Implémentez cette méthode si vous avez besoin de compter les articles par sous-catégorie
    // Cela nécessite d'avoir la relation avec les articles dans votre entité SubCategoryEntity
    return 0; // Remplacez par l'implémentation réelle
  }
}