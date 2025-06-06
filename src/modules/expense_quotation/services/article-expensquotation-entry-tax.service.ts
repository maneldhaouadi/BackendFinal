/* eslint-disable prettier/prettier */
import { Injectable } from '@nestjs/common';
import { TaxService } from 'src/modules/tax/services/tax.service';
import { ArticleExpensQuotationEntryTaxEntity } from '../repositories/entities/article-expensquotation-entry-tax.entity';
import { ArticleExpensQuotationEntryTaxRepository } from '../repositories/repository/article-expensquotation-entry-tax.repository';
import { CreateArticleExpensQuotationEntryTaxDto } from '../dtos/article-expensquotation-entry-tax.create.dto';

@Injectable()
export class ArticleExpensQuotationEntryTaxService {
  constructor(
    private readonly articleExpensQuotationEntryTaxRepository: ArticleExpensQuotationEntryTaxRepository,
    private readonly taxService: TaxService,
  ) {}

  // Fonction pour sauvegarder une nouvelle entrée de taxe
  async save(
    createArticleExpensQuotationEntryTaxDto: CreateArticleExpensQuotationEntryTaxDto
  ): Promise<ArticleExpensQuotationEntryTaxEntity> {
    const tax = await this.taxService.findOneById(
      createArticleExpensQuotationEntryTaxDto.taxId,
    );
    const taxEntry = await this.articleExpensQuotationEntryTaxRepository.save({
      expenseArticleEntryId: createArticleExpensQuotationEntryTaxDto.expenseArticleEntryId,
      tax,
    });
    return taxEntry;
  }

  // Fonction pour sauvegarder plusieurs entrées de taxes
  async saveMany(
createArticleExpensQuotationEntryTaxDtos: CreateArticleExpensQuotationEntryTaxDto[],
  ): Promise<ArticleExpensQuotationEntryTaxEntity[]> {
    const savedEntries = [];
    for (const dto of createArticleExpensQuotationEntryTaxDtos) {
      const savedEntry = await this.save(dto);
      savedEntries.push(savedEntry);
    }
    return savedEntries;
  }

  async softDelete(id: number): Promise<void> {
    await this.articleExpensQuotationEntryTaxRepository.softDelete(id);
  }

  async softDeleteMany(ids: number[]): Promise<void> {
    ids.forEach(async (id) => await this.softDelete(id));
  }

}
