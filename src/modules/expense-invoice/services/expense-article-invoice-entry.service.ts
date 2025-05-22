import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { TaxService } from 'src/modules/tax/services/tax.service';
import { ArticleService } from 'src/modules/article/services/article.service';
import { ResponseArticleDto } from 'src/modules/article/dtos/article.response.dto';
import { InvoicingCalculationsService } from 'src/common/calculations/services/invoicing.calculations.service';
import { LineItem } from 'src/common/calculations/interfaces/line-item.interface';
import { IQueryObject } from 'src/common/database/interfaces/database-query-options.interface';
import { QueryBuilder } from 'src/common/database/utils/database-query-builder';
import { FindOneOptions } from 'typeorm';
import { ExpenseArticleInvoiceEntryRepository } from '../repositories/repository/expense-invoice-article-entry.repository';
import { ExpenseArticleInvoiceEntryTaxService } from './expense-article-invoice-entry-tax.service';
import { ExpenseResponseArticleInvoiceEntryDto } from '../dtos/expense-article-invoice-entry.response.dto';
import { ExpenseArticleInvoiceEntryEntity } from '../repositories/entities/expense-article-invoice-entry.entity';
import { ExpenseCreateArticleInvoiceEntryDto } from '../dtos/expense-article-invoice-entry.create.dto';
import { ExpenseUpdateArticleInvoiceEntryDto } from '../dtos/expense-article-invoice-entry.update.dto';
import { ExpenseArticleInvoiceEntryNotFoundException } from '../errors/expense-article-invoice-entry.notfound.error';
import { ArticleEntity } from 'src/modules/article/repositories/entities/article.entity';
import { UpdateArticleDto } from 'src/modules/article/dtos/article.update.dto';
import { ArticleStatus } from 'src/modules/article/interfaces/article-data.interface';

@Injectable()
export class ExpenseArticleInvoiceEntryService {
  constructor(
    private readonly articleInvoiceEntryRepository: ExpenseArticleInvoiceEntryRepository,
    private readonly articleInvoiceEntryTaxService: ExpenseArticleInvoiceEntryTaxService,
    private readonly articleService: ArticleService,
    private readonly taxService: TaxService,
    private readonly calculationsService: InvoicingCalculationsService,
  ) {}

  async findOneByCondition(
    query: IQueryObject,
  ): Promise<ExpenseResponseArticleInvoiceEntryDto | null> {
    const queryBuilder = new QueryBuilder();
    const queryOptions = queryBuilder.build(query);
    const entry = await this.articleInvoiceEntryRepository.findOne(
      queryOptions as FindOneOptions<ExpenseArticleInvoiceEntryEntity>,
    );
    if (!entry) return null;
    return entry;
  }

  async findOneById(id: number): Promise<ExpenseResponseArticleInvoiceEntryDto> {
    const entry = await this.articleInvoiceEntryRepository.findOneById(id);
    if (!entry) {
      throw new ExpenseArticleInvoiceEntryNotFoundException();
    }
    return entry;
  }

  async findOneAsLineItem(id: number): Promise<LineItem> {
    const entry = await this.findOneByCondition({
      filter: `id||$eq||${id}`,
      join: 'expenseArticleInvoiceEntryTaxes',
    });
    const taxes = entry.articleInvoiceEntryTaxes
      ? await Promise.all(
          entry.articleInvoiceEntryTaxes.map((taxEntry) =>
            this.taxService.findOneById(taxEntry.taxId),
          ),
        )
      : [];
    return {
      quantity: entry.quantity,
      unit_price: entry.unit_price,
      discount: entry.discount,
      discount_type: entry.discount_type,
      taxes: taxes,
    };
  }

  async findManyAsLineItem(ids: number[]): Promise<LineItem[]> {
    const lineItems = await Promise.all(
      ids.map((id) => this.findOneAsLineItem(id)),
    );
    return lineItems;
  }

  async save(
    createArticleInvoiceEntryDto: ExpenseCreateArticleInvoiceEntryDto,
  ): Promise<ExpenseArticleInvoiceEntryEntity> {
    // Récupérer les taxes
    const taxes = createArticleInvoiceEntryDto.taxes
      ? await Promise.all(
          createArticleInvoiceEntryDto.taxes.map(id => this.taxService.findOneById(id))
        )
      : [];
  
    // Trouver l'article par référence ou titre
    let article = createArticleInvoiceEntryDto.article.reference
      ? await this.articleService.findOneByCondition({
          filter: `reference||$eq||${createArticleInvoiceEntryDto.article.reference}`
        })
      : null;
  
    if (!article && createArticleInvoiceEntryDto.article.title) {
      article = await this.articleService.findOneByCondition({
        filter: `title||$eq||${createArticleInvoiceEntryDto.article.title}`
      });
    }
  
    if (!article) {
      // Créer un nouvel article sans historique
      article = await this.articleService.save({
        ...createArticleInvoiceEntryDto.article,
        reference: createArticleInvoiceEntryDto.article.reference || 
                  `REF-${Math.floor(100000000 + Math.random() * 900000000)}`,
        quantityInStock: createArticleInvoiceEntryDto.quantity || 0,
        unitPrice: createArticleInvoiceEntryDto.unit_price || 0
      });
    } else {
      // Mettre à jour l'article existant sans historique
      await this.articleService.update(article.id, {
        quantityInStock: (article.quantityInStock || 0) - (createArticleInvoiceEntryDto.quantity || 0),
        unitPrice: createArticleInvoiceEntryDto.unit_price || article.unitPrice || 0
      });
    }
  
    // Créer l'entrée de facture
    const entry = await this.articleInvoiceEntryRepository.save({
      ...createArticleInvoiceEntryDto,
      reference: article.reference,
      articleId: article.id,
      article: article,
      subTotal: this.calculationsService.calculateSubTotalForLineItem({
        quantity: createArticleInvoiceEntryDto.quantity,
        unit_price: createArticleInvoiceEntryDto.unit_price,
        discount: createArticleInvoiceEntryDto.discount,
        discount_type: createArticleInvoiceEntryDto.discount_type,
        taxes: taxes
      }),
      total: this.calculationsService.calculateTotalForLineItem({
        quantity: createArticleInvoiceEntryDto.quantity,
        unit_price: createArticleInvoiceEntryDto.unit_price,
        discount: createArticleInvoiceEntryDto.discount,
        discount_type: createArticleInvoiceEntryDto.discount_type,
        taxes: taxes
      })
    });
  
    // Sauvegarder les taxes associées
    if (taxes.length > 0) {
      await this.articleInvoiceEntryTaxService.saveMany(
        taxes.map(tax => ({
          taxId: tax.id,
          articleInvoiceEntryId: entry.id
        }))
      );
    }
  
    return entry;
  }

  async saveMany(
    createArticleInvoiceEntryDtos: ExpenseCreateArticleInvoiceEntryDto[],
  ): Promise<ExpenseArticleInvoiceEntryEntity[]> {
    const savedEntries = [];
    for (const dto of createArticleInvoiceEntryDtos) {
      const savedEntry = await this.save(dto);
      savedEntries.push(savedEntry);
    }
    return savedEntries;
  }

  async update(
    id: number,
    updateDto: ExpenseUpdateArticleInvoiceEntryDto,
  ): Promise<ExpenseArticleInvoiceEntryEntity> {
    // 1. Récupérer l'entrée avec l'article
    const existingEntry = await this.articleInvoiceEntryRepository.findOne({
      where: { id },
      relations: ['article'],
      lock: { mode: "pessimistic_write" }
    });
  
    if (!existingEntry?.article) {
      throw new NotFoundException('Article entry or associated article not found');
    }
  
    // 2. Mettre à jour TOUTES les propriétés de l'article
    const articleUpdates: UpdateArticleDto = {
      title: updateDto.article?.title ?? existingEntry.article.title,
      description: updateDto.article?.description ?? existingEntry.article.description,
      reference: updateDto.article?.reference ?? existingEntry.article.reference,
      unitPrice: updateDto.unit_price ?? existingEntry.article.unitPrice,
    };
  
    // 3. Sauvegarder l'article d'abord
    const updatedArticle = await this.articleService.update(existingEntry.article.id, articleUpdates);
  
    // 4. Mettre à jour l'entrée de facture avec l'article fraîchement mis à jour
    const updatedEntry = await this.articleInvoiceEntryRepository.save({
      ...existingEntry,
      quantity: updateDto.quantity ?? existingEntry.quantity,
      unit_price: updateDto.unit_price ?? existingEntry.unit_price,
      discount: updateDto.discount ?? existingEntry.discount,
      discount_type: updateDto.discount_type ?? existingEntry.discount_type,
      article: updatedArticle // Utilisez l'article mis à jour retourné par le service
    });
  
    return updatedEntry;
  }


  async duplicate(
    id: number,
    newInvoiceId: number,
  ): Promise<ExpenseArticleInvoiceEntryEntity> {
    // 1. Récupérer l'entrée existante avec ses relations
    const existingEntry = await this.articleInvoiceEntryRepository.findOne({
      where: { id },
      relations: [
        'expenseArticleInvoiceEntryTaxes',
      ],
    });
  
    if (!existingEntry) {
      throw new Error(`Entry with id ${id} not found`);
    }
  
    // 2. Générer une nouvelle référence unique
    const generateNewReference = () => {
      const timestamp = Date.now().toString().slice(-6);
      const randomNum = Math.floor(100 + Math.random() * 900);
      return `REF-${timestamp}-${randomNum}`; // Format simplifié
    };
  
    const newReference = generateNewReference();
  
    // 3. Créer un nouvel article avec nouvelle référence
    const newArticle = existingEntry.article 
      ? {
          ...existingEntry.article,
          id: undefined, // Nouvel ID auto-généré
          reference: newReference, // Nouvelle référence unique
          createdAt: undefined,
          updatedAt: undefined,
        }
      : null;
  
    // 4. Préparer les taxes à dupliquer
    const duplicatedTaxes = existingEntry.expenseArticleInvoiceEntryTaxes?.map((taxEntry) => ({
      taxId: taxEntry.taxId,
    })) || [];
  
    // 5. Créer l'entrée dupliquée
    const duplicatedEntry = this.articleInvoiceEntryRepository.create({
      ...existingEntry,
      id: undefined, // Nouvel ID auto-généré
      reference: newReference, // Ajout de la nouvelle référence directement sur l'entrée
      expenseInvoiceId: newInvoiceId, // Assigner le nouvel ID de facture
      article: newArticle, // Utiliser le nouvel article (peut être null)
      expenseArticleInvoiceEntryTaxes: undefined, // Réinitialiser les taxes
      createdAt: undefined,
      updatedAt: undefined,
    });
  
    // 6. Sauvegarder la nouvelle entrée
    const newEntry = await this.articleInvoiceEntryRepository.save(duplicatedEntry);
  
    // 7. Sauvegarder les taxes associées si elles existent
    if (duplicatedTaxes.length > 0) {
      await this.articleInvoiceEntryTaxService.saveMany(
        duplicatedTaxes.map((tax) => ({
          taxId: tax.taxId,
          articleInvoiceEntryId: newEntry.id,
        })),
      );
    }
  
    // 8. Sauvegarder le nouvel article si nécessaire
  
  
    // 9. Retourner l'entrée complète avec ses relations
    return this.articleInvoiceEntryRepository.findOne({
      where: { id: newEntry.id },
      relations: ['expenseArticleInvoiceEntryTaxes', 'article'],
    });
  }
  async duplicateMany(
    ids: number[],
    invoiceId: number,
  ): Promise<ExpenseArticleInvoiceEntryEntity[]> {
    const duplicatedEntries = [];
    for (const id of ids) {
      const duplicatedEntry = await this.duplicate(id, invoiceId);
      duplicatedEntries.push(duplicatedEntry);
    }
    return duplicatedEntries;
  }

  async softDelete(id: number): Promise<ExpenseArticleInvoiceEntryEntity> {
    const entry = await this.articleInvoiceEntryRepository.findByCondition({
      where: { id, deletedAt: null },
      relations: { expenseArticleInvoiceEntryTaxes: true },
    });
    await this.articleInvoiceEntryTaxService.softDeleteMany(
      entry.expenseArticleInvoiceEntryTaxes.map((taxEntry) => taxEntry.id),
    );
    return this.articleInvoiceEntryRepository.softDelete(id);
  }

  async softDeleteMany(ids: number[]): Promise<ExpenseArticleInvoiceEntryEntity[]> {
    const entries = await Promise.all(
      ids.map(async (id) => this.softDelete(id)),
    );
    return entries;
  }
}
