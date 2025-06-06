import { EntityHelper } from 'src/common/database/interfaces/database.entity.interface';
import { ExpensQuotationEntity } from './expensquotation.entity';
import { Column, Entity, PrimaryGeneratedColumn, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { ArticleExpensQuotationEntryTaxEntity } from './article-expensquotation-entry-tax.entity';
import { DISCOUNT_TYPES } from 'src/app/enums/discount-types.enum';
import { ArticleEntity } from 'src/modules/article/article/repositories/entities/article.entity';

@Entity('expense_article_quotation_entry') // Match the table name in SQL
export class ArticleExpensQuotationEntryEntity extends EntityHelper {
  
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'float', nullable: true })
  quantity: number;

  @Column({ type: 'float', nullable: true })
  discount: number;

  @Column({ name: 'discount_type', type: 'enum', enum: DISCOUNT_TYPES, nullable: true })
discount_type: DISCOUNT_TYPES;


  @Column({ type: 'float', nullable: true })
  subTotal: number;

  @Column({ type: 'float', nullable: true })
  total: number;

  @Column({ type: 'int', nullable: true })
  articleId: number;

  @ManyToOne(() => ArticleEntity, { nullable: true })
  @JoinColumn({ name: 'articleId' })
  article: ArticleEntity;

  @ManyToOne(() => ExpensQuotationEntity, { nullable: true })
  @JoinColumn({ name: 'expenseQuotationId' })
  expenseQuotation: ExpensQuotationEntity;

  // Soft delete and timestamps inherited from EntityHelper
  @OneToMany(
    () => ArticleExpensQuotationEntryTaxEntity,
    (articleQuotationEntryTax) => articleQuotationEntryTax.expenseArticleEntry,
  )
  articleExpensQuotationEntryTaxes: ArticleExpensQuotationEntryTaxEntity[];

  @Column({ length: 50, nullable: true })
  reference: string;

  @Column({ type: 'int', nullable: true })
  expenseQuotationId: number; // Ajoutez cette colonne







  


    @Column({ name: 'ordered_quantity', type: 'float', nullable: true })
  orderedQuantity: number; // Nouveau champ pour la quantité commandée

  @Column({ name: 'original_stock', type: 'float', nullable: true })
  originalStock: number; // Stock original au moment de la commande

   @Column({ name: 'unit_price', type: 'float', nullable: true })
  unit_price: number;
}