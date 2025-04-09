import { EntityRepository, Repository } from 'typeorm';
import { CategoryEntity } from '../entities/category.entity';
import { NotFoundException } from '@nestjs/common';

@EntityRepository(CategoryEntity)
export class CategoryRepository extends Repository<CategoryEntity> {
  async findById(id: number, withSubCategories = false): Promise<CategoryEntity> {
    const relations = [];
    if (withSubCategories) {
      relations.push('subCategories');
    }

    const category = await this.findOne({
      where: { id },
      relations,
    });

    if (!category) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }

    return category;
  }

  async findAllWithSubCategories(): Promise<CategoryEntity[]> {
    return this.find({
      relations: ['subCategories'],
      order: {
        name: 'ASC',
      },
    });
  }

  async findByName(name: string): Promise<CategoryEntity | undefined> {
    return this.findOne({
      where: { name },
    });
  }

  async createCategory(createData: Partial<CategoryEntity>): Promise<CategoryEntity> {
    const category = this.create(createData);
    return this.save(category);
  }

  async updateCategory(id: number, updateData: Partial<CategoryEntity>): Promise<CategoryEntity> {
    const category = await this.findById(id);
    this.merge(category, updateData);
    return this.save(category);
  }

  async deleteCategory(id: number): Promise<void> {
    const result = await this.softDelete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }
  }

  async restoreCategory(id: number): Promise<void> {
    const result = await this.restore(id);
    if (result.affected === 0) {
      throw new NotFoundException(`Category with ID ${id} not found or not deleted`);
    }
  }

  async countArticlesInCategory(categoryId: number): Promise<number> {
    // Implémentez cette méthode si vous avez besoin de compter les articles par catégorie
    // Cela nécessite d'avoir la relation avec les articles dans votre entité CategoryEntity
    return 0; // Remplacez par l'implémentation réelle
  }
}