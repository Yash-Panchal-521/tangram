using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Tangram.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddLabels : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "labels",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    board_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "text", nullable: false),
                    color = table.Column<string>(type: "text", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_labels", x => x.id);
                    table.ForeignKey(
                        name: "fk_labels_boards_board_id",
                        column: x => x.board_id,
                        principalTable: "boards",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "card_labels",
                columns: table => new
                {
                    card_id = table.Column<Guid>(type: "uuid", nullable: false),
                    label_id = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_card_labels", x => new { x.card_id, x.label_id });
                    table.ForeignKey(
                        name: "fk_card_labels_cards_card_id",
                        column: x => x.card_id,
                        principalTable: "cards",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_card_labels_labels_label_id",
                        column: x => x.label_id,
                        principalTable: "labels",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_card_labels_label_id",
                table: "card_labels",
                column: "label_id");

            migrationBuilder.CreateIndex(
                name: "ix_labels_board_id_name",
                table: "labels",
                columns: new[] { "board_id", "name" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "card_labels");

            migrationBuilder.DropTable(
                name: "labels");
        }
    }
}
