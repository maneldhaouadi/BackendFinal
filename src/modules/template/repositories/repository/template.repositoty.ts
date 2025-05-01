import { Repository } from 'typeorm';
import { DatabaseAbstractRepository } from 'src/common/database/utils/database.repository';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Template } from '../entities/template.entity';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { TemplateType } from '../../enums/TemplateType';

@Injectable()
export class TemplateRepository extends DatabaseAbstractRepository<Template> {
  constructor(
    @InjectRepository(Template)
    private readonly templateRepository: Repository<Template>,
    txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {
    super(templateRepository, txHost);
  }

  async findAllActive(): Promise<Template[]> {
    return this.templateRepository.find({
      where: { deletedAt: null },
      order: { createdAt: 'DESC' },
    });
  }

  async findByType(type: TemplateType): Promise<Template[]> {
    return this.templateRepository.find({
      where: { 
        type,
        deletedAt: null 
      },
      order: { isDefault: 'DESC', name: 'ASC' },
    });
  }

  async findDefaultByType(type: TemplateType): Promise<Template | null> {
    return this.templateRepository.findOne({
      where: { 
        type,
        isDefault: true,
        deletedAt: null 
      },
    });
  }

  // Dans template.repository.ts
async findDefaultsByType(type: TemplateType): Promise<Template[]> {
    return this.templateRepository.find({
        where: { 
            type,
            isDefault: true,
            deletedAt: null
        }
    });
}

// Dans template.repository.ts
async updateMultiple(ids: number[], partialEntity: Partial<Template>): Promise<void> {
    await this.templateRepository
        .createQueryBuilder()
        .update()
        .set(partialEntity)
        .whereInIds(ids)
        .execute();
}
}